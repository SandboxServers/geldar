package dev.geldar.core.proximity;

import java.time.Duration;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Supplier;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * Runs the chat judge on the server thread and waits for its result (decision 0199, step 5). The async chat thread
 * cannot read blocks. Any failure gives an empty set, so no other player hears the line: a timeout, an interrupt, a
 * refused submit (a disabled plugin throws) and a judge that throws all fail closed. A future that is not finished
 * is cancelled, so a late run does not outlive its line by much. An interrupt restores the thread's flag.
 */
public final class ChatHop<T> {
    /** Queues work for the server thread; a disabled plugin throws here. */
    public interface Submitter<T> {
        Future<Set<T>> submit(Callable<Set<T>> work);
    }

    private final BooleanSupplier onServerThread;
    private final Submitter<T> submitter;
    private final Duration timeout;
    private final Consumer<String> log;

    public ChatHop(BooleanSupplier onServerThread, Submitter<T> submitter, Duration timeout, Consumer<String> log) {
        this.onServerThread = onServerThread;
        this.submitter = submitter;
        this.timeout = timeout;
        this.log = log;
    }

    /** The Bukkit hop for the chat judge: waits at most two seconds, and gives an empty set on any failure. */
    public static ProximityChatListener.ServerHop bukkit(Plugin plugin, Consumer<String> log) {
        ChatHop<Player> hop = new ChatHop<>(
                Bukkit::isPrimaryThread,
                work -> Bukkit.getScheduler().callSyncMethod(plugin, work),
                Duration.ofSeconds(2),
                log);
        return hop::call;
    }

    /** The result of {@code work} on the server thread, or an empty set when the hop fails. */
    public Set<T> call(Supplier<Set<T>> work) {
        if (onServerThread.getAsBoolean()) {
            try {
                return work.get();
            } catch (RuntimeException e) {
                return giveUp(null, "judge failed", e);
            }
        }
        Future<Set<T>> future = null;
        try {
            future = submitter.submit(work::get);
            return future.get(timeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return giveUp(future, "interrupted", e);
        } catch (TimeoutException e) {
            return giveUp(future, "timed out", e);
        } catch (ExecutionException | RuntimeException e) {
            return giveUp(future, "failed", e);
        }
    }

    private Set<T> giveUp(Future<Set<T>> future, String reason, Exception cause) {
        if (future != null) {
            future.cancel(true);
        }
        log.accept("chat hearing skipped (" + reason + "); no listener hears this line: "
                + cause.getClass().getSimpleName());
        return Set.of();
    }
}
