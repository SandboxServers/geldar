package dev.geldar.core.blockowner;

import dev.geldar.core.trace.OtelTraceHook;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;

import io.nats.client.Connection;
import io.nats.client.impl.Headers;
import io.nats.client.impl.NatsMessage;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import io.opentelemetry.api.trace.TraceFlags;
import io.opentelemetry.api.trace.TraceState;
import io.opentelemetry.context.Context;
import io.opentelemetry.context.Scope;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class NatsBlockOwnerLinkTraceTest {
    private static final String TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
    private static final String TRACEPARENT = "00-" + TRACE_ID + "-00f067aa0ba902b7-01";
    private static final String JSON = "{\"owner\":\"x\"}";

    private record Sent(String subject, Headers headers, byte[] body) {}

    private static Connection fake(List<Sent> sent) {
        return (Connection) Proxy.newProxyInstance(Connection.class.getClassLoader(), new Class<?>[] {Connection.class},
                (proxy, method, args) -> {
                    if (method.getName().equals("publish")) {
                        if (args.length == 2) {
                            sent.add(new Sent((String) args[0], null, (byte[]) args[1]));
                        } else {
                            sent.add(new Sent((String) args[0], (Headers) args[1], (byte[]) args[2]));
                        }
                    }
                    return null;
                });
    }

    private static NatsBlockOwnerLink link(List<Sent> sent, boolean traced) {
        NatsBlockOwnerLink link = new NatsBlockOwnerLink("nats://x", "s", k -> null, Logger.getAnonymousLogger());
        link.attach(fake(sent));
        if (traced) {
            link.setTrace(new OtelTraceHook());
        }
        return link;
    }

    private static Scope span() {
        SpanContext sc = SpanContext.create(TRACE_ID, "00f067aa0ba902b7", TraceFlags.getSampled(),
                TraceState.getDefault());
        return Span.wrap(sc).makeCurrent();
    }

    private static NatsMessage query(Headers headers) {
        return NatsMessage.builder().subject("q").replyTo("_INBOX.2").headers(headers)
                .data("{}".getBytes(StandardCharsets.UTF_8)).build();
    }

    @Test
    void replyWithSpanCarriesTraceparentAndSameBody() {
        List<Sent> plain = new ArrayList<>();
        link(plain, false).reply("_INBOX.1", JSON);
        List<Sent> sent = new ArrayList<>();
        try (Scope ignored = span()) {
            link(sent, true).reply("_INBOX.1", JSON);
        }
        assertEquals(1, sent.size());
        assertEquals("_INBOX.1", sent.get(0).subject());
        assertEquals(TRACEPARENT, sent.get(0).headers().getFirst("traceparent"));
        assertArrayEquals(plain.get(0).body(), sent.get(0).body());
        assertArrayEquals(JSON.getBytes(StandardCharsets.UTF_8), sent.get(0).body());
    }

    @Test
    void replyWithoutSpanUsesTheOldTwoArgumentPublish() {
        List<Sent> sent = new ArrayList<>();
        link(sent, true).reply("_INBOX.1", JSON);
        assertEquals(1, sent.size());
        assertNull(sent.get(0).headers());
    }

    @Test
    void replyWithNoConnectionIsDropped() {
        NatsBlockOwnerLink link = new NatsBlockOwnerLink("nats://x", "s", k -> null, Logger.getAnonymousLogger());
        link.setTrace(new OtelTraceHook());
        try (Scope ignored = span()) {
            link.reply("_INBOX.1", JSON);
        }
    }

    @Test
    void queryHeaderExtrasDoNotReachTheReply() {
        List<Sent> sent = new ArrayList<>();
        NatsBlockOwnerLink link = link(sent, true);
        Headers in = new Headers();
        in.put("traceparent", TRACEPARENT);
        in.put("baggage", "user=alice");
        in.put("x-custom", "v");
        link.handle(query(in), (replyTo, body) -> link.reply(replyTo, JSON));
        assertEquals(1, sent.size());
        Headers out = sent.get(0).headers();
        assertEquals(TRACEPARENT, out.getFirst("traceparent").replaceFirst("-[0-9a-f]{16}-", "-00f067aa0ba902b7-"));
        assertFalse(out.containsKey("baggage"));
        assertFalse(out.containsKey("x-custom"));
        assertEquals(1, out.size());
    }

    @Test
    void handlerRunsInsideTheQueryContextAndRestoresIt() {
        NatsBlockOwnerLink link = link(new ArrayList<>(), true);
        Headers in = new Headers();
        in.put("traceparent", TRACEPARENT);
        String[] seen = new String[1];
        link.handle(query(in), (replyTo, body) -> seen[0] = Span.current().getSpanContext().getTraceId());
        assertEquals(TRACE_ID, seen[0]);
        assertFalse(Span.current().getSpanContext().isValid());
        assertSame(Context.root(), Context.current());
    }

    @Test
    void handlerClosesTheScopeWhenTheHandlerThrows() {
        NatsBlockOwnerLink link = link(new ArrayList<>(), true);
        Headers in = new Headers();
        in.put("traceparent", TRACEPARENT);
        try {
            link.handle(query(in), (r, b) -> {
                throw new IllegalStateException("boom");
            });
        } catch (IllegalStateException expected) {
            // the scope must still be closed
        }
        assertFalse(Span.current().getSpanContext().isValid());
    }

    @Test
    void changedPublishIsNeverTraced() {
        List<Sent> sent = new ArrayList<>();
        try (Scope ignored = span()) {
            link(sent, true).changed(JSON);
        }
        assertEquals(1, sent.size());
        assertEquals("geldar.s.blockowner.changed", sent.get(0).subject());
        assertNull(sent.get(0).headers());
    }
}
