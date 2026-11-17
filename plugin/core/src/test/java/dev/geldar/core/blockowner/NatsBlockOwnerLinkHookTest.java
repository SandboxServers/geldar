package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import dev.geldar.core.trace.OtelTraceHook;
import dev.geldar.core.trace.TraceHook;
import io.nats.client.Connection;
import io.nats.client.impl.Headers;
import io.nats.client.impl.NatsMessage;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class NatsBlockOwnerLinkHookTest {
    private static final String TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
    private static final String TRACEPARENT = "00-" + TRACE_ID + "-00f067aa0ba902b7-01";

    private static Connection fake(List<Headers> sent) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("publish")) {
                        sent.add(args.length == 2 ? null : (Headers) args[1]);
                    }
                    return null;
                });
    }

    private static NatsMessage query() {
        return NatsMessage.builder().subject("q").replyTo("_INBOX.9")
                .headers(new Headers().put("traceparent", TRACEPARENT))
                .data("{}".getBytes(StandardCharsets.UTF_8)).build();
    }

    private static NatsBlockOwnerLink link(List<Headers> sent, TraceHook hook) {
        NatsBlockOwnerLink link = new NatsBlockOwnerLink("nats://x", "s", k -> null, Logger.getAnonymousLogger());
        link.attach(fake(sent));
        link.setTrace(hook);
        return link;
    }

    /** A hook whose every call fails with a linkage error, as a broken agent bridge would. */
    private static final class Broken implements TraceHook {
        @Override
        public Headers inject(Headers target) {
            throw new NoClassDefFoundError("bridge");
        }

        @Override
        public Scope enter(Headers incoming) {
            throw new NoSuchMethodError("bridge");
        }

        @Override
        public Captured capture() {
            throw new NoClassDefFoundError("bridge");
        }

        @Override
        public Headers inject(Headers target, Captured from) {
            throw new NoClassDefFoundError("bridge");
        }

        @Override
        public void annotate(String key, String value) {}
    }

    @Test
    void aThrowingHookNeverDropsTheQuery() {
        List<String> seen = new ArrayList<>();
        link(new ArrayList<>(), new Broken()).handle(query(), (replyTo, body) -> seen.add(replyTo + body));
        assertEquals(List.of("_INBOX.9{}"), seen);
    }

    @Test
    void aThrowingHookNeverDropsTheReply() {
        List<Headers> sent = new ArrayList<>();
        link(sent, new Broken()).reply("_INBOX.9", "{}");
        assertEquals(1, sent.size());
        assertNull(sent.get(0));
    }

    @Test
    void aThrowingHookDoesNotDropTheReplyAfterAHandledQuery() {
        List<Headers> sent = new ArrayList<>();
        NatsBlockOwnerLink link = link(sent, new Broken());
        link.handle(query(), (replyTo, body) -> {});
        link.reply("_INBOX.9", "{}");
        assertEquals(1, sent.size());
    }

    @Test
    void theReplyOnAnotherThreadCarriesTheQueryTraceWithNoCurrentSpan() throws Exception {
        List<Headers> sent = new ArrayList<>();
        NatsBlockOwnerLink link = link(sent, new OtelTraceHook());
        link.handle(query(), (replyTo, body) -> {});
        Thread lookup = new Thread(() -> link.reply("_INBOX.9", "{}"));
        lookup.start();
        lookup.join();
        assertEquals(1, sent.size());
        assertEquals(TRACEPARENT.substring(0, 36), sent.get(0).getFirst("traceparent").substring(0, 36));
    }

    @Test
    void aReplyForAnUnknownInboxUsesNoContext() {
        List<Headers> sent = new ArrayList<>();
        link(sent, new OtelTraceHook()).reply("_INBOX.other", "{}");
        assertNull(sent.get(0));
    }
}
