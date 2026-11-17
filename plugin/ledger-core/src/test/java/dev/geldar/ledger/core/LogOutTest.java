package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.logs.LogRecordBuilder;
import io.opentelemetry.api.logs.Logger;
import java.lang.reflect.Proxy;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class LogOutTest {
    @Test
    void neverCallsToStringOnAnObjectItIsHandedAndKeepsTypedValues() {
        Map<String, Object> seen = new LinkedHashMap<>();
        AtomicInteger emitted = new AtomicInteger();
        LogRecordBuilder builder = (LogRecordBuilder) Proxy.newProxyInstance(
                LogRecordBuilder.class.getClassLoader(), new Class<?>[] {LogRecordBuilder.class}, (p, m, a) -> {
                    if (m.getName().equals("setAttribute") && a[0] instanceof AttributeKey<?> k) {
                        seen.put(k.getKey(), a[1]);
                    }
                    if (m.getName().equals("emit")) {
                        emitted.incrementAndGet();
                    }
                    return m.getReturnType() == LogRecordBuilder.class ? p : null;
                });
        Logger logger = (Logger) Proxy.newProxyInstance(
                Logger.class.getClassLoader(), new Class<?>[] {Logger.class}, (p, m, a) -> builder);
        Object bomb = new Object() {
            @Override
            public String toString() {
                throw new AssertionError("LogOut must not stringify raw objects");
            }
        };
        Map<String, Object> attrs = new LinkedHashMap<>();
        attrs.put("geldar.text", "scrubbed");
        attrs.put("geldar.x", 5L);
        attrs.put("geldar.y", 6);
        attrs.put("geldar.z", 1.5);
        attrs.put("geldar.flag", true);
        attrs.put("geldar.command", bomb);
        LogOut.over(logger).emit("e", Severity.INFO, "body", attrs, 0L);
        assertEquals(1, emitted.get());
        assertEquals("scrubbed", seen.get("geldar.text"));
        assertEquals(5L, seen.get("geldar.x"));
        assertEquals(6L, seen.get("geldar.y"));
        assertEquals(1.5, seen.get("geldar.z"));
        assertEquals(true, seen.get("geldar.flag"));
        assertNull(seen.get("geldar.command"));
    }
}
