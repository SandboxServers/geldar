package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class RedactorTest {
    /** Builds a dotted quad at runtime so no address literal sits in the source (decision 0132). */
    private static String q(int a, int b, int c, int d) {
        return a + "." + b + "." + c + "." + d;
    }

    @Test
    void credentialKeysAreDetected() {
        for (String k : new String[] {
            "rcon.password", "RCON.PASSWORD", "db-passwd", "client_secret", "auth.token", "Authorization",
            "apiKey", "api_key", "api-key", "api.key", "private.key", "Set-Cookie", "credentials", "private_key",
            "private-key", "token", "auth_token", "pwd", "jwt", "bearer", "sessionId", "email", "secret",
            "password", "authorization", "cookie", "accessToken", "emailAddress", "geldar.content.password",
            // Parity with the gateway: "token" is a whole word here, so the brief's example is dropped there too.
            "geldar.token_bucket"
        }) {
            assertTrue(Redactor.keyIsCredential(k), k);
        }
        for (String k : new String[] {
            "geldar.world", "geldar.text", "minecraft.player.uuid", "", "input_tokens",
            "gen_ai.usage.input_tokens", "max_tokens", "output_tokens", "tokens",
            "inputTokens", "pwdx"
        }) {
            assertFalse(Redactor.keyIsCredential(k), k);
        }
        assertFalse(Redactor.keyIsCredential(null));
    }

    @Test
    void keyRuleIsLinearOnUppercaseRuns() {
        String key = "A".repeat(1 << 20);
        Redactor.keyIsCredential(key);
        long t0 = System.nanoTime();
        assertFalse(Redactor.keyIsCredential(key));
        assertFalse(Redactor.keyIsCredential("aB".repeat(500_000)));
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 2000);
    }

    @Test
    void labelGluedToIpv6IsStillScrubbed() {
        assertEquals("node:[addr]", Redactor.scrub("node:2001:db8::1"));
        assertEquals("Hostname:[addr]", Redactor.scrub("Hostname:fe80::1"));
        assertEquals("ip6:[addr]", Redactor.scrub("ip6:2001:db8::1"));
        // End boundary: a word character after the address means it is not an address.
        assertEquals("[addr] up", Redactor.scrub("2001:db8::1 up"));
        assertSame("2001:db8::1x", Redactor.scrub("2001:db8::1x"));
        assertSame("2001:db8::g", Redactor.scrub("2001:db8::g"));
        // Start boundary: a word character glued without a colon keeps the text.
        for (String s : new String[] {"a2001:db8::1", "Cache::get", "std::vector", "x::1", "12:30:45", "12:30:45.123"}) {
            assertSame(s, Redactor.scrub(s), s);
        }
    }

    @Test
    void largeInputsStayLinear() {
        String[] shapes = {
            "node:2001:db8::1 ".repeat(60_000), "a1".repeat(500_000) + ":", "xa1 ".repeat(250_000) + ":",
            "e:".repeat(500_000), "1.".repeat(500_000), "10.0.0.1".repeat(130_000)
        };
        for (String s : shapes) {
            long t0 = System.nanoTime();
            Redactor.scrub(s);
            long ms = (System.nanoTime() - t0) / 1_000_000;
            assertTrue(ms < 1500, "scrub took " + ms + " ms for length " + s.length());
        }
    }

    @Test
    void ipv4WithGluedLabelsAndZeroPaddingIsScrubbed() {
        assertEquals("Connecting...[addr]", Redactor.scrub("Connecting..." + q(10, 0, 0, 1)));
        assertEquals("ip[addr]", Redactor.scrub("ip" + q(10, 0, 0, 1)));
        assertEquals("[addr]x", Redactor.scrub(q(10, 0, 0, 1) + "x"));
        assertEquals("[addr]", Redactor.scrub("010.000.000.001"));
        assertEquals("[addr]", Redactor.scrub("192.168.001.001"));
        assertEquals("a [addr]. b", Redactor.scrub("a " + q(10, 0, 0, 1) + ". b"));
        // Out of range octets are not an address.
        assertSame("256.1.1.1", Redactor.scrub("256.1.1.1"));
    }

    @Test
    void versionStringsAndLongerDottedRunsKeepTheirText() {
        for (String s : new String[] {
            "v1.2.3.4", "V1.2.3.4", "version 1.2.3.4", "Version 1.2.3.4", "java 1.2.3.4", "Java 1.2.3.4",
            "1.2.3.4.5", "5.1.2.3.4", "1.2.3.4.5.6", "20240101.1.2.3.4"
        }) {
            assertSame(s, Redactor.scrub(s), s);
        }
        // A word that merely ends in v is not a version prefix.
        assertEquals("dev[addr]", Redactor.scrub("dev" + q(10, 0, 0, 1)));
        // Documented caveat: a bare four-part number is masked.
        assertEquals("build [addr]", Redactor.scrub("build 1.20.4.1"));
    }
    @Test
    void redactAttrReplacesCredentialValueAndScrubsStrings() {
        assertEquals("[redacted]", Redactor.redactAttr("rcon.password", "hunter2"));
        assertEquals("[redacted]", Redactor.redactAttr("rcon.password", 5L));
        assertEquals("at [addr] now", Redactor.redactAttr("geldar.text", "at " + q(10, 0, 0, 5) + " now"));
        assertEquals(7L, Redactor.redactAttr("geldar.amount", 7L));
    }

    @Test
    void ipv4LiteralsAreScrubbed() {
        assertEquals("from [addr] ok", Redactor.scrub("from " + q(192, 168, 1, 20) + " ok"));
        assertEquals("[addr]:25565", Redactor.scrub(q(10, 0, 0, 1) + ":25565"));
        assertEquals("a [addr], b [addr].", Redactor.scrub("a " + q(172, 16, 0, 9) + ", b " + q(127, 0, 0, 1) + "."));
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
