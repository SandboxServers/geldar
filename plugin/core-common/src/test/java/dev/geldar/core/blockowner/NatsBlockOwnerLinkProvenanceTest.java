package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.nats.client.Connection;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class NatsBlockOwnerLinkProvenanceTest {
    /** A connection that records every publish as subject and body. */
    private static Connection recording(List<String> subjects, List<String> bodies) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("publish")) {
                        subjects.add((String) args[0]);
                        bodies.add(new String((byte[]) args[args.length == 2 ? 1 : 2], StandardCharsets.UTF_8));
                    }
                    return null;
                });
    }

    private static NatsBlockOwnerLink link(List<String> subjects, List<String> bodies) {
        NatsBlockOwnerLink link = new NatsBlockOwnerLink("nats://x", "s", k -> null, Logger.getAnonymousLogger());
        link.attach(recording(subjects, bodies));
        return link;
    }

    @Test
    void sendBreakPublishesOnTheBreakSubject() {
        List<String> subjects = new ArrayList<>();
        List<String> bodies = new ArrayList<>();
        ProvenanceSink sink = link(subjects, bodies);

        sink.send("break", "{\"kind\":\"break\"}");

        assertEquals(List.of("geldar.s.provenance.break"), subjects);
        assertEquals(List.of("{\"kind\":\"break\"}"), bodies);
        assertEquals("geldar.s.provenance.break", NatsBlockOwnerLink.provenanceSubject("s", "break"));
    }

    @Test
    void sendKnownTailsPublishOnTheirOwnSubject() {
        List<String> subjects = new ArrayList<>();
        List<String> bodies = new ArrayList<>();
        ProvenanceSink sink = link(subjects, bodies);

        sink.send("pickup", "{}");
        sink.send("take", "{}");
        sink.send("combat", "{}");

        assertEquals(List.of("geldar.s.provenance.pickup", "geldar.s.provenance.take", "geldar.s.provenance.combat"),
                subjects);
    }

    @Test
    void anUnknownTailIsDropped() {
        List<String> subjects = new ArrayList<>();
        List<String> bodies = new ArrayList<>();
        ProvenanceSink sink = link(subjects, bodies);

        sink.send("changed", "{}");
        sink.send("blockowner.changed", "{}");
        sink.send("", "{}");
        sink.send(null, "{}");

        assertTrue(subjects.isEmpty(), "unknown tails must not publish: " + subjects);
    }

    @Test
    void sendWithoutAConnectionDoesNotThrow() {
        NatsBlockOwnerLink link = new NatsBlockOwnerLink("nats://x", "s", k -> null, Logger.getAnonymousLogger());

        link.send("break", "{}");
    }
}
