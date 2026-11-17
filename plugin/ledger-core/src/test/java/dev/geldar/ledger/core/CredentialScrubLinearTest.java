package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The credential scrub is linear: adversarial shapes at 1 MiB and 10 MiB stay under generous bounds
 * (a quadratic scanner needs minutes at 10 MiB). Bounds are wide on purpose so a loaded CI host does not flake.
 */
class CredentialScrubLinearTest {
    private static final int MIB = 1 << 20;
    private static final String PW = CredentialScrubTest.PW;
    private static final String TK = CredentialScrubTest.TK;

    private static Map<String, String> shapes() {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("key and comma", PW + "=a,");
        m.put("key, delimiter, value", PW + "=Zq9x,K2mP7vL4Ab ");
        m.put("bearer", "Bearer a");
        m.put("bearer colon", "Bearer: a ");
        m.put("letters", "a");
        m.put("scheme userinfo", "x://u:");
        m.put("scheme and at", "a://:@");
        m.put("600-char run", PW + "=" + "a".repeat(600) + " ");
        m.put("600-char delimiter run", PW + ":a" + ",".repeat(600) + "x ");
        m.put("trailing paren run", PW + ":a" + ")".repeat(510) + "x ");
        m.put("pair cuts", PW + "=a,b=c," + PW + "=d,e=f ");
        m.put("backslash soup", "\\\"" + PW + "\\\":\\\"\\\\\\\"");
        m.put("backslashes", "\\");
        m.put("escaped quotes after key", "{\"" + PW + "\":\"" + "\\\"".repeat(40));
        m.put("unclosed quote", TK + "=\"abc ");
        m.put("key chain", "a=b:" + TK + "=");
        m.put("authorization words", "Authorization");
        m.put("authorization colons", "Authorization: ");
        m.put("authorization json", "{\"Authorization\":");
        m.put("authorization equals", "authorization=authorization");
        m.put("jwt prefix", "eyJ-");
        m.put("pem begin", "-----BEGIN ");
        m.put("pem label", "-----BEGIN " + "A".repeat(39) + " ");
        m.put("gmcp", "gmcp-");
        m.put("ats", "@");
        m.put("slashes", "/");
        m.put("cookie", "Cookie: a=");
        m.put("flag", "--" + PW + " ");
        m.put("flag value", "--" + PW + " Zq9xK2mP7vL4Ab ");
        m.put("flag spaces", "--" + TK + " ".repeat(100));
        m.put("curl -u", "-u a:b ");
        m.put("curl -u secret", "-u a:Zq9xK2mP7vL4Ab ");
        m.put("query sig", "?sig=");
        m.put("query key", "?key=Zq9xK2mP7vL4AbZq9x&");
        m.put("query amz", "&X-Amz-Credential=a ");
        m.put("one long flag run", "--" + PW + " " + "a".repeat(1000));
        m.put("dashes", "-");
        return m;
    }

    private static String repeat(String unit, int size) {
        return unit.repeat((size + unit.length() - 1) / unit.length());
    }

    private static long millis(String input) {
        long start = System.nanoTime();
        String out = Redactor.scrub(input);
        long ms = (System.nanoTime() - start) / 1_000_000;
        assertTrue(out != null);
        return ms;
    }

    @Test
    void everyShapeIsFastAt1MiBAnd10MiB() {
        for (Map.Entry<String, String> shape : shapes().entrySet()) {
            millis(repeat(shape.getValue(), 1 << 16)); // warm-up
            long one = Math.min(millis(repeat(shape.getValue(), MIB)), millis(repeat(shape.getValue(), MIB)));
            long ten = millis(repeat(shape.getValue(), 10 * MIB));
            System.out.println("scrub timing [" + shape.getKey() + "] 1 MiB " + one + " ms, 10 MiB " + ten + " ms");
            assertTrue(one < 3000, shape.getKey() + " 1 MiB took " + one + " ms");
            assertTrue(ten < 15000, shape.getKey() + " 10 MiB took " + ten + " ms");
        }
    }

    @Test
    void oneLongRunIsLinear() {
        assertTrue(millis("a".repeat(10 * MIB)) < 15000);
        assertTrue(millis(PW + "=" + "a".repeat(10 * MIB)) < 15000);
        assertTrue(millis("Bearer " + "a".repeat(10 * MIB)) < 15000);
        assertTrue(millis("{\"" + PW + "\":\"" + "\\\"".repeat(MIB / 2)) < 3000);
        assertTrue(millis("Authorization" + " ".repeat(MIB) + "x") < 3000);
        assertTrue(millis("gmcp-" + "a".repeat(MIB)) < 3000);
        assertTrue(millis("http://" + "u:".repeat(MIB / 2)) < 3000);
        assertTrue(millis("-u " + "a:".repeat(5 * MIB)) < 15000);
    }

    @Test
    void oneTenMiBValueAfterAFlagIsHiddenWhole() {
        String text = "--" + PW + " " + "a1".repeat(5 * MIB);
        long start = System.nanoTime();
        String out = Redactor.scrub(text);
        long ms = (System.nanoTime() - start) / 1_000_000;
        assertTrue(out.equals("--" + PW + " " + Redactor.REDACTED), "value not hidden whole");
        assertTrue(ms < 15000, "took " + ms + " ms");
    }
}
