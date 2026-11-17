package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class RedactorTest {
    @Test
    void credentialKeysAreDetected() {
        for (String k : new String[] {
            "rcon.password", "RCON.PASSWORD", "db-passwd", "client_secret", "auth.token", "Authorization",
            "apiKey", "api_key", "api-key", "Set-Cookie", "credentials", "private_key", "private-key"
        }) {
            assertTrue(Redactor.keyIsCredential(k), k);
        }
        for (String k : new String[] {"geldar.world", "geldar.text", "minecraft.player.uuid", ""}) {
            assertFalse(Redactor.keyIsCredential(k), k);
        }
        assertFalse(Redactor.keyIsCredential(null));
    }

    @Test
    void redactAttrReplacesCredentialValueAndScrubsStrings() {
        assertEquals("[redacted]", Redactor.redactAttr("rcon.password", "hunter2"));
        assertEquals("[redacted]", Redactor.redactAttr("rcon.password", 5L));
        assertEquals("at [addr] now", Redactor.redactAttr("geldar.text", "at 10.0.0.5 now"));
        assertEquals(7L, Redactor.redactAttr("geldar.amount", 7L));
    }

    @Test
    void ipv4LiteralsAreScrubbed() {
        assertEquals("from [addr] ok", Redactor.scrub("from 192.168.1.20 ok"));
        assertEquals("[addr]:25565", Redactor.scrub("10.0.0.1:25565"));
        assertEquals("a [addr], b [addr].", Redactor.scrub("a 172.16.0.9, b 127.0.0.1."));
    }

    @Test
    void ipv6LiteralsAreScrubbed() {
        assertEquals("peer [addr] up", Redactor.scrub("peer 2001:db8::1 up"));
        assertEquals("peer [addr] up", Redactor.scrub("peer 2001:0db8:0000:0000:0000:0000:0000:0001 up"));
        assertEquals("[addr]", Redactor.scrub("[::1]:25565"));
        assertEquals("x [addr]", Redactor.scrub("x [::1]"));
        assertEquals("loop [addr].", Redactor.scrub("loop ::1."));
        assertEquals("m [addr] m", Redactor.scrub("m ::ffff:192.0.2.1 m"));
    }

    @Test
    void textWithoutAddressIsIdentical() {
        for (String s : new String[] {
            "hello world", "std::vector<int>", "meet at 12:30:45 sharp", "version 1.2.3.4.5 released",
            "ratio 3:1", "see: it", "a.b.c.d", "ab:cd", "1.2.3", "x::y", "", "§6golden §rapple"
        }) {
            assertSame(s, Redactor.scrub(s), s);
        }
        assertEquals(null, Redactor.scrub(null));
    }

    @Test
    void adversarialInputIsFast() {
        String a = (":".repeat(25) + "a").repeat(1000);
        String b = ("1:".repeat(8) + ":").repeat(3000);
        String c = "1.".repeat(25000);
        for (String s : new String[] {a, b, c, "f".repeat(50000), ":".repeat(50000)}) {
            Redactor.scrub(s);
            long t0 = System.nanoTime();
            Redactor.scrub(s);
            long ms = (System.nanoTime() - t0) / 1_000_000;
            assertTrue(ms < 200, "scrub took " + ms + " ms");
        }
    }
}
