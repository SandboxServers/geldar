package dev.geldar.core.proximity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.nats.client.Connection;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The hearing sink over a fake connection: the subject, the payload, the drops and the close (decision 0199, step 9). */
class NatsHearingSinkTest {
    private static final String LIFE = "ag_kestrel_01";
    private static final String SUBJECT = "geldar.phase0.body.ag_kestrel_01.hearing";

    /** A connection that records publishes and closes. {@code refuse} makes publish throw, as a closed one does. */
    private static final class FakeConnection {
        final List<String> published = new ArrayList<>();
        int closes;
        boolean refuse;

        Connection asConnection() {
            return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class<?>[] {Connection.class},
                    (proxy, method, args) -> {
                        switch (method.getName()) {
                            case "publish" -> {
                                if (refuse) {
                                    throw new IllegalStateException("connection closed");
                                }
                                published.add(args[0] + " " + new String((byte[]) args[1], StandardCharsets.UTF_8));
                                return null;
                            }
                            case "close" -> {
                                closes++;
                                return null;
                            }
                            default -> throw new UnsupportedOperationException(method.getName());
                        }
                    });
        }
    }

    @Test
    void aNoticeGoesToTheLifeSubjectAsTheHeardMuffledJson() {
        FakeConnection fake = new FakeConnection();
        NatsHearingSink sink = new NatsHearingSink("phase0", fake.asConnection());
        sink.muffled(LIFE, "w", "far");
        assertEquals(List.of(SUBJECT + " {\"kind\":\"heard_muffled\",\"direction\":\"w\",\"band\":\"far\"}"),
                fake.published);
        assertEquals(0, sink.dropped());
    }

    @Test
    void aNameThatIsNotALifeIdIsNeverPublished() {
        FakeConnection fake = new FakeConnection();
        new NatsHearingSink("phase0", fake.asConnection()).muffled("Steve", "n", "near");
        assertTrue(fake.published.isEmpty());
    }

    @Test
    void aNoticeWithNoConnectionIsCountedAsDroppedAndNeverThrown() {
        NatsHearingSink sink = new NatsHearingSink("phase0", null);
        sink.muffled(LIFE, "n", "near");
        assertEquals(1, sink.dropped());
        sink.muffled(LIFE, "s", "far");
        assertEquals(2, sink.dropped());
    }

    @Test
    void aRefusedPublishIsCountedAndNeverThrown() {
        FakeConnection fake = new FakeConnection();
        fake.refuse = true;
        NatsHearingSink sink = new NatsHearingSink("phase0", fake.asConnection());
        sink.muffled(LIFE, "n", "near");
        sink.muffled(LIFE, "s", "far");
        assertEquals(2, sink.dropped());
        assertTrue(fake.published.isEmpty());
    }

    @Test
    void closeClosesTheConnectionOnce() throws Exception {
        FakeConnection fake = new FakeConnection();
        NatsHearingSink sink = new NatsHearingSink("phase0", fake.asConnection());
        sink.close();
        assertEquals(1, fake.closes);
    }

    @Test
    void closeWithNoConnectionDoesNotThrow() throws Exception {
        new NatsHearingSink("phase0", null).close();
    }

    @Test
    void theSubjectNamesTheShardAndTheLife() {
        assertEquals(SUBJECT, NatsHearingSink.subject("phase0", LIFE));
    }
}
