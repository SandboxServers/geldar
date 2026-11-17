package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.nats.client.Connection;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class NatsKinoSinkTest {
    private static Connection connection(List<String> subjects, boolean refuse) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("publish")) {
                        if (refuse) {
                            throw new IllegalStateException("closed");
                        }
                        subjects.add((String) args[0]);
                    }
                    return null;
                });
    }

    @Test
    void aPublishedMessageIsCountedAndNotDropped() {
        List<String> subjects = new ArrayList<>();
        NatsKinoSink sink = new NatsKinoSink("phase0", connection(subjects, false));
        sink.publish("ag_a", "{}");
        sink.publish("ag_a", "{}");
        assertEquals(List.of("geldar.phase0.kino.ag_a.feed", "geldar.phase0.kino.ag_a.feed"), subjects);
        assertEquals(2, sink.published());
        assertEquals(0, sink.dropped());
    }

    @Test
    void aRefusedPublishIsDroppedNotPublished() {
        NatsKinoSink sink = new NatsKinoSink("phase0", connection(new ArrayList<>(), true));
        sink.publish("ag_a", "{}");
        assertEquals(0, sink.published());
        assertEquals(1, sink.dropped());
    }

    @Test
    void noConnectionDropsAndCountsTheMessage() {
        NatsKinoSink sink = new NatsKinoSink("phase0", null);
        sink.publish("ag_a", "{}");
        assertEquals(0, sink.published());
        assertEquals(1, sink.dropped());
    }
}