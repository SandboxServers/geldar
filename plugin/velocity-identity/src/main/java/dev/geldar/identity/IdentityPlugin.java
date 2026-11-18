package dev.geldar.identity;

import com.google.inject.Inject;
import com.velocitypowered.api.event.PostOrder;
import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.event.player.ServerPostConnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.ServerConnection;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
import com.velocitypowered.api.scheduler.ScheduledTask;
import com.velocitypowered.api.util.GameProfile;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import net.kyori.adventure.text.Component;
import org.slf4j.Logger;

/**
 * Geldar bot-ingress identity (spec Appendix F, 8.4, decision 0021). Velocity admits a connection
 * only when its username is registered for a living life; Paper's whitelist is a second, independent check.
 * The checks read a local cache fed from NATS, so the event loop never waits on the network.
 */
@Plugin(
        id = "geldar-identity",
        name = "Geldar Identity",
        version = "0.1.0",
        description = "Admits only usernames registered for a living life",
        authors = {"Geldar"})
public final class IdentityPlugin {
    /** The mechanic channel (spec Appendix F). Only admitted connections may send on it. */
    static final MinecraftChannelIdentifier COMMAND_CHANNEL = MinecraftChannelIdentifier.create("geldar", "cmd");
    /** Velocity to Paper only: marks the connection as a ghost. Must equal GhostListener.CHANNEL in Geldar-Core. */
    static final MinecraftChannelIdentifier GHOST_CHANNEL = MinecraftChannelIdentifier.create("geldar", "ghost");
    static final byte[] GHOST_SIGNAL = {1};
    /** Profile property marking a live login; must equal GhostListener.LIVE_PROPERTY in Geldar-Core. */
    static final String LIVE_PROPERTY = "geldar_live";
    static final String LIVE_VALUE = "1";
    /** Written while the proxy runs; the Velocity healthcheck in compose/phase0.yml reads it. */
    static final Path READY_FILE = Path.of("/tmp/geldar-identity.ready");

    private final ProxyServer proxy;
    private final Logger log;
    private final LifeRegistry registry = new LifeRegistry();
    /** The lane from {@link IdentityLane#ENV}; empty when the setting is not a lane, which refuses the gate. */
    private final Optional<IdentityLane> lane;
    private final LoginGate gate;
    /** Set at init when the gate must not admit anyone: an invalid lane, or the human lane behind an offline proxy. */
    private volatile boolean refused;
    /** The life registry's feed; it writes the readiness marker while the registry is synced. */
    private final ReadinessFeed lifeFeed;
    private final SkinRegistry skins;
    private final DenialLimiter denials;
    /** The login that reserved a new human slot, by UUID. Only that login gives the slot back if it is refused. */
    private final Map<UUID, LoginEvent> slotOwners = new ConcurrentHashMap<>();
    private static final int MAX_LOGGED_DENIALS = 10;
    private static final long DENY_WINDOW_NANOS = TimeUnit.SECONDS.toNanos(10);
    /** The profile property Mojang's session servers use for skins. */
    static final String TEXTURES = "textures";

    private final Supplier<String> natsUrl;
    private RegistryClient client;
    private RegistryClient skinClient;
    private ScheduledTask denialSummary;

    @Inject
    public IdentityPlugin(ProxyServer proxy, Logger log) {
        this(proxy, log, () -> System.getenv("GELDAR_NATS_URL"), new SkinRegistry(log),
                ReadyMarker.forThisProcess(READY_FILE), () -> System.getenv(IdentityLane.ENV));
    }

    /** Takes the NATS URL source, so a test can leave it unset without touching the environment. */
    IdentityPlugin(ProxyServer proxy, Logger log, Supplier<String> natsUrl) {
        this(proxy, log, natsUrl, new SkinRegistry(log));
    }

    /** Takes the skin store too, so a test can make its lookups fail. */
    IdentityPlugin(ProxyServer proxy, Logger log, Supplier<String> natsUrl, SkinRegistry skins) {
        this(proxy, log, natsUrl, skins, ReadyMarker.forThisProcess(READY_FILE));
    }

    /** Takes the marker too, so a test can point it at a temporary directory. The lane is unset: the agent lane. */
    IdentityPlugin(ProxyServer proxy, Logger log, Supplier<String> natsUrl, SkinRegistry skins, ReadyMarker marker) {
        this(proxy, log, natsUrl, skins, marker, () -> null);
    }

    /** Takes the lane source too, so a test can select the human lane without touching the environment. */
    IdentityPlugin(ProxyServer proxy, Logger log, Supplier<String> natsUrl, SkinRegistry skins, ReadyMarker marker,
            Supplier<String> laneSetting) {
        this.proxy = proxy;
        this.log = log;
        this.natsUrl = natsUrl;
        this.skins = skins;
        this.lane = IdentityLane.parse(laneSetting.get());
        String url = natsUrl.get();
        boolean registryExpected = url != null && !url.isBlank();
        this.gate = new LoginGate(registry, lane.orElse(IdentityLane.AGENT), registryExpected);
        this.lifeFeed = new ReadinessFeed(registry, marker, log);
        this.denials = new DenialLimiter(MAX_LOGGED_DENIALS, DENY_WINDOW_NANOS, System::nanoTime,
                count -> log.info("{} more denials were not logged in the last window", count));
    }

    @Subscribe
    public void onProxyInitialization(ProxyInitializeEvent event) {
        // Velocity only raises PluginMessageEvent for registered channels; others pass straight through.
        proxy.getChannelRegistrar().register(COMMAND_CHANNEL, GHOST_CHANNEL);
        log.info("Geldar identity enabled");
        // Scheduled before the URL check: a missing URL denies every login, which is when the summary matters most.
        denialSummary = proxy.getScheduler().buildTask(this, denials::tick).repeat(DENY_WINDOW_NANOS, TimeUnit.NANOSECONDS).schedule();
        if (lane.isEmpty()) {
            refuse(IdentityLane.ENV + " must be unset, agent or human");
            return;
        }
        if (lane.get() == IdentityLane.HUMAN && !humanProxyIsOnline()) {
            refuse("the human lane needs an online-mode proxy");
            return;
        }
        String url = natsUrl.get();
        if (url == null || url.isBlank()) {
            if (lane.get() == IdentityLane.HUMAN) {
                // The human lane needs no registry: an enabled proxy is ready, and the name rules still apply.
                lifeFeed.markReadyWithoutRegistry();
                log.info("human lane: GELDAR_NATS_URL is not set; the registry is not used");
                return;
            }
            log.error("GELDAR_NATS_URL is not set; every login will be denied");
            return;
        }
        client = new RegistryClient(url, RegistryClient.BUCKET, lifeFeed, log);
        client.start();
        skinClient = new RegistryClient(url, SkinRegistry.BUCKET, skins, log);
        skinClient.start();
    }

    @Subscribe
    public void onProxyShutdown(ProxyShutdownEvent event) {
        if (denialSummary != null) {
            denialSummary.cancel();
        }
        if (client != null) {
            client.close();
        }
        if (skinClient != null) {
            skinClient.close();
        }
        lifeFeed.retire();
    }

    /** Denies before the player is handed to Paper: a denied LoginEvent ends the connection at the proxy. */
    @Subscribe(order = PostOrder.FIRST)
    public void onLogin(LoginEvent event) {
        Player player = event.getPlayer();
        if (alreadyConnected(player)) {
            // Velocity's own "already connected" reply would tell a stranger the name is online (decision 0137).
            event.setResult(ResultedEvent.ComponentResult.denied(Component.text(LoginGate.DENY_MESSAGE)));
            if (denials.allow()) {
                log.info("Denied {}", printable(player.getUsername()));
            }
            return;
        }
        LoginGate.Reservation reservation = refused
                ? LoginGate.Reservation.DENIED
                : gate.reserve(player.getUniqueId(), player.getUsername());
        if (reservation != LoginGate.Reservation.DENIED) {
            if (reservation == LoginGate.Reservation.NEW_SLOT) {
                slotOwners.put(player.getUniqueId(), event);
            }
            String name = printable(player.getUsername());
            log.info(gate.isSpectator(player.getUniqueId()) ? "Admitted {} as a spectator" : "Admitted {}", name);
            return;
        }
        event.setResult(ResultedEvent.ComponentResult.denied(Component.text(LoginGate.DENY_MESSAGE)));
        if (denials.allow()) {
            log.info("Denied {}", printable(player.getUsername()));
        }
    }

    /**
     * Gives back a human slot that its login reserved and did not keep: the login ends refused after the reservation,
     * whether a later handler denied it or none did. Only the login that reserved the slot can give it back, so a second
     * login that shared the slot cannot free it. A slot whose login was kept stays held until its disconnect.
     */
    @Subscribe(order = PostOrder.LAST)
    public void onLoginSettled(LoginEvent event) {
        UUID connection = event.getPlayer().getUniqueId();
        if (slotOwners.remove(connection, event) && !event.getResult().isAllowed()) {
            gate.release(connection);
        }
    }

    /**
     * Tells Paper a ghost is a ghost (decision 0092): one message on {@code geldar:ghost} each time the
     * backend connection comes up. Geldar-Core holds that player in spectator. Velocity has no game-mode API.
     */
    @Subscribe
    public void onServerPostConnect(ServerPostConnectEvent event) {
        Player player = event.getPlayer();
        if (!gate.isSpectator(player.getUniqueId())) {
            return;
        }
        // Fail closed: a signal that cannot be sent leaves a ghost without its marker, so the ghost goes.
        Optional<ServerConnection> server = player.getCurrentServer();
        if (server.isEmpty()) {
            log.warn("No backend for {}; disconnecting", printable(player.getUsername()));
            player.disconnect(Component.text(LoginGate.DENY_MESSAGE));
            return;
        }
        if (!server.get().sendPluginMessage(GHOST_CHANNEL, GHOST_SIGNAL)) {
            log.warn("Could not mark {} as a spectator; disconnecting", printable(player.getUsername()));
            player.disconnect(Component.text(LoginGate.DENY_MESSAGE));
        }
    }

    /** Refuses the gate: every login is denied from now on. The reason is logged, never sent to a client. */
    private void refuse(String reason) {
        refused = true;
        log.error("Geldar identity gate refused: {}; every login will be denied", reason);
    }

    /**
     * True when the proxy runs in online mode. The human lane refuses to start behind an offline-mode proxy.
     * {@code ProxyServer#getConfiguration()} and {@code ProxyConfig#isOnlineMode()} are the velocity-api 3.5.1 calls
     * this compiles against; a missing configuration counts as offline (fail closed).
     */
    private boolean humanProxyIsOnline() {
        return proxy.getConfiguration() != null && proxy.getConfiguration().isOnlineMode();
    }

    /** True when another connection already holds this name. */
    private boolean alreadyConnected(Player player) {
        if (proxy == null) {
            return false; // handler tests build the plugin without a proxy
        }
        return proxy.getPlayer(player.getUsername()).filter(other -> other != player).isPresent();
    }

    @Subscribe
    public void onDisconnect(DisconnectEvent event) {
        release(event.getPlayer().getUniqueId(), event.getLoginStatus());
    }

    /**
     * Forgets an admission when its connection ends. A login that lost to an already connected player of the
     * same name ends with CONFLICTING_LOGIN and shares that player's UUID: it must not revoke the live admission.
     */
    void release(UUID connection, DisconnectEvent.LoginStatus status) {
        if (status == DisconnectEvent.LoginStatus.CONFLICTING_LOGIN) {
            return;
        }
        gate.release(connection);
    }

    /**
     * Gives a registered life its stored skin. The lookup is in memory, so login never waits on NATS. Only a stored,
     * validated texture replaces the profile's textures property; nothing the client sends can set one. The gate
     * decides admission on its own: this handler never changes it. Any failure keeps the default profile.
     */
    @Subscribe
    public void onGameProfile(GameProfileRequestEvent event) {
        markLive(event);
        try {
            Optional<LifeRegistry.Entry> life = registry.find(event.getGameProfile().getName());
            if (life.isEmpty()) {
                log.info("skin: lookup skipped (not a sovereign life)");
                return;
            }
            String lifeId = printable(life.get().lifeId());
            Optional<SkinRegistry.Texture> texture = skins.find(life.get().lifeId());
            if (texture.isPresent()) {
                event.setGameProfile(withTexture(event.getGameProfile(), texture.get()));
                log.info("skin: applied for {} (variant {})", lifeId, texture.get().variant());
            } else if (!skins.isSynced()) {
                log.warn("skin: KV unavailable: NotSynced");
            } else if (skins.rejectionOf(life.get().lifeId()) != null) {
                log.warn("skin: record for {} rejected: {}", lifeId, skins.rejectionOf(life.get().lifeId()));
            } else {
                log.info("skin: no record for {}", lifeId);
            }
        } catch (RuntimeException e) {
            log.warn("skin: KV unavailable: {}", e.getClass().getSimpleName());
        }
    }

    /**
     * Sets {@link #LIVE_PROPERTY} on a login the gate classifies as live, and on no other (decision 0137).
     * Modern forwarding signs profile properties, so Paper can trust it; Paper treats its absence as a ghost.
     * Any such property already on the profile is dropped first.
     */
    private void markLive(GameProfileRequestEvent event) {
        GameProfile profile = event.getGameProfile();
        List<GameProfile.Property> properties = new ArrayList<>();
        for (GameProfile.Property property : profile.getProperties()) {
            if (!LIVE_PROPERTY.equals(property.getName())) {
                properties.add(property);
            }
        }
        if (gate.decide(profile.getId(), profile.getName()) == LoginGate.Admission.LIVE) {
            properties.add(new GameProfile.Property(LIVE_PROPERTY, LIVE_VALUE, ""));
        }
        event.setGameProfile(profile.withProperties(properties));
    }

    /** The profile with its textures property replaced by the stored one; the other properties are kept. */
    static GameProfile withTexture(GameProfile profile, SkinRegistry.Texture texture) {
        List<GameProfile.Property> properties = new ArrayList<>();
        for (GameProfile.Property property : profile.getProperties()) {
            if (!TEXTURES.equals(property.getName())) {
                properties.add(property);
            }
        }
        properties.add(new GameProfile.Property(TEXTURES, texture.value(), texture.signature()));
        return profile.withProperties(properties);
    }

    /** Drops {@code geldar:cmd} messages from any client connection that was not admitted. */
    @Subscribe(order = PostOrder.FIRST)
    public void onPluginMessage(PluginMessageEvent event) {
        if (!COMMAND_CHANNEL.equals(event.getIdentifier())) {
            return;
        }
        if (event.getSource() instanceof Player player && !gate.isAdmitted(player.getUniqueId())) {
            event.setResult(PluginMessageEvent.ForwardResult.handled());
        }
    }

    /** A username comes from the client: keep it short and plain before it reaches the log. */
    static String printable(String username) {
        String text = username == null ? "" : username.length() > 32 ? username.substring(0, 32) : username;
        return text.replaceAll("[^A-Za-z0-9_.-]", "?");
    }
}
