package dev.geldar.identity;

import com.google.inject.Inject;
import com.velocitypowered.api.event.PostOrder;
import com.velocitypowered.api.event.ResultedEvent;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.connection.DisconnectEvent;
import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.event.connection.PluginMessageEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.messages.MinecraftChannelIdentifier;
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

    private final ProxyServer proxy;
    private final Logger log;
    private final LifeRegistry registry = new LifeRegistry();
    private final LoginGate gate = new LoginGate(registry);
    private RegistryClient client;

    @Inject
    public IdentityPlugin(ProxyServer proxy, Logger log) {
        this.proxy = proxy;
        this.log = log;
    }

    @Subscribe
    public void onProxyInitialization(ProxyInitializeEvent event) {
        // Velocity only raises PluginMessageEvent for registered channels; others pass straight through.
        proxy.getChannelRegistrar().register(COMMAND_CHANNEL);
        log.info("Geldar identity enabled");
        String url = System.getenv("GELDAR_NATS_URL");
        if (url == null || url.isBlank()) {
            log.error("GELDAR_NATS_URL is not set; every login will be denied");
            return;
        }
        client = new RegistryClient(url, registry, log);
        client.start();
    }

    @Subscribe
    public void onProxyShutdown(ProxyShutdownEvent event) {
        if (client != null) {
            client.close();
        }
    }

    /** Denies before the player is handed to Paper: a denied LoginEvent ends the connection at the proxy. */
    @Subscribe(order = PostOrder.FIRST)
    public void onLogin(LoginEvent event) {
        Player player = event.getPlayer();
        if (gate.admit(player.getUniqueId(), player.getUsername())) {
            log.info("Admitted {}", printable(player.getUsername()));
            return;
        }
        event.setResult(ResultedEvent.ComponentResult.denied(Component.text(LoginGate.DENY_MESSAGE)));
        log.info("Denied {}", printable(player.getUsername()));
    }

    @Subscribe
    public void onDisconnect(DisconnectEvent event) {
        gate.release(event.getPlayer().getUniqueId());
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
