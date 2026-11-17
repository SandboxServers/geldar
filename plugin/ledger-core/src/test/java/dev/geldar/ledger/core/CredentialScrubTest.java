package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Port of the TypeScript redactor tests (telemetry/test/redact-*.test.ts) for the free-text credential scrub.
 * Credential-shaped fixtures are built at run time so no literal secret sits in the source.
 */
class CredentialScrubTest {
    static final String R = Redactor.REDACTED;
    static final String PW = String.join("", "pass", "word");
    static final String TK = String.join("", "to", "ken");
    static final String SEC = String.join("", "sec", "ret");
    static final String CK = String.join("", "coo", "kie");
    static final String HEX = "a1b2c3d4e5f6";

    static String scrub(String s) {
        return Redactor.scrub(s);
    }

    static void same(String text) {
        assertEquals(text, scrub(text), text);
    }

    static void hides(String expected, String input) {
        assertEquals(expected, scrub(input), input);
    }

    /** A JSON string literal. */
    static String q(String v) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : v.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\t' -> b.append("\\t");
                default -> b.append(c);
            }
        }
        return b.append('"').toString();
    }

    static String pair(String key, String value, String after) {
        return "{" + q(key) + ":" + q(value) + "," + q("after") + ":" + q(after) + "}";
    }

    @Test
    void ordinaryGameAndProseTextIsUnchanged() {
        String[] ordinary = {
            "Secret: north", SEC + "=north", PW + ": swordfish", "Password: please", TK + ": 5", TK + "=gold coin",
            CK + ": chocolate chip", "Cookie: 3 in chest", "credential: none", "Enter the " + PW + ": open sesame",
            CK + "s=12", SEC + "s: 3", SEC + "ary: Bob", "sessionid: 4", "pwd: /home", CK + "s=1234567890",
            SEC + "ary: Bartholomew_2", "tokens=123456789", "pwd=/tmp", "Standard Bearer Alexander arrives",
            "Flag Bearer Gandalf", "Torch Bearer: Alexander", "the bearer of bad news", "Bearer of bad news",
            TK + " economy", "Authorization: not-yet-granted-by-admin", "The Secret Garden", SEC + " door: north",
            "key: gold", "monkey=banana", "compass: north", "author: Burnett", "max_tokens=100", "input_tokens: 12",
            "time: 12:30:45", "https://example.org/path", "user@example.org", "max_tokens=100", "tokens=5",
            "email: bob@example.org", "name=steve count: 4",
            "auth: none", "auth=true", "session: 4", "session_id: 4", "jwt: none", "sig=abc", "code=12345678",
            "access: granted", PW + ": swordfish, then run", PW + ": swordfish; then run", "(" + PW + ": swordfish)",
            TK + "=5,name=bob,other=x", "{\"max\":1,\"" + TK + "_type\":\"a\"}", PW + ": north.",
            "{\"" + TK + "\":5,\"other\":\"x\",\"k\":\"y\"}", PW + "=abcdefghi, then", PW + ": \"open sesame\"",
            "Welcome to Geldar. 12 players online, tick 20.0, you are at x=12 y=64 z=-3.",
        };
        for (String text : ordinary) {
            same(text);
        }
    }

    @Test
    void jsonWithTokenTypeKeepsTheType() {
        hides("{\"access_" + TK + "\":\"" + R + "\",\"" + TK + "_type\":\"Bearer\"}",
                "{\"access_" + TK + "\":\"" + HEX + "\",\"" + TK + "_type\":\"Bearer\"}");
    }

    @Test
    void credentialLookingValuesAreHidden() {
        hides(PW + ": " + R, PW + ": Xk3_" + HEX);
        hides(TK + ": " + R, TK + ": " + HEX + HEX);
        hides(SEC + "=" + R, SEC + "=" + "z".repeat(12));
        hides(TK + ": " + R, TK + ": 12345678");
        hides("/p?x=1&" + TK + "=" + R, "/p?x=1&" + TK + "=abc");
        hides("--" + PW + "=" + R, "--" + PW + "=x");
        hides(PW + "=\"" + R + "\"", PW + "=\"open sesame now\"");
        hides("Cookie: " + R, "Cookie: a=1; sid=" + HEX);
        hides("Cookie: " + R, "Cookie: a=1; session=abcd");
        hides(R, "bearer " + HEX);
        hides(R, "Bearer " + HEX);
        hides(R, "Bearer abcd1234");
        hides("aws_secret_access_key = " + R, "aws_secret_access_key = " + HEX + HEX);
        hides("API_" + TK.toUpperCase() + "=" + R, "API_" + TK.toUpperCase() + "=" + HEX);
    }

    @Test
    void keysInsideUrlsAndOtherPairsAreHidden() {
        hides("https://h/cb?" + TK + "=" + R, "https://h/cb?" + TK + "=abc");
        hides("GET https://h/x?access_" + TK + "=" + R + "&x=1 HTTP/1.1",
                "GET https://h/x?access_" + TK + "=abcDEF123456&x=1 HTTP/1.1");
        hides("user:" + PW + "=" + R, "user:" + PW + "=xK3_9aZq");
        hides("a=b:" + TK + "=" + R, "a=b:" + TK + "=xK3_9aZq");
        hides("url=http://x/?" + PW + "=" + R, "url=http://x/?" + PW + "=z");
        hides("{\"url\":\"https://h/x?" + TK + "=" + R + "\"}", "{\"url\":\"https://h/x?" + TK + "=abcDEF123456\"}");
        hides("{" + q(PW) + ":" + q(R) + ",\"ok\":1}", "{" + q(PW) + ":\"open sesame now\",\"ok\":1}");
    }

    @Test
    void moreCredentialWordsInText() {
        for (String key : new String[] {"session_id", "sessionId", "jwt", "auth", "access_key", "signing_key", "ssh_key"}) {
            hides(key + "=" + R, key + "=abc123XYZ789");
            hides("x " + key + ": " + R, "x " + key + ": abc123XYZ789");
            hides("{\"" + key + "\":\"" + R + "\"}", "{\"" + key + "\":\"abc123XYZ789\"}");
        }
    }

    @Test
    void quotedValueWithEscapesIsHiddenWhole() {
        for (String middle : new String[] {"\"", "\"\"", "\\\"", "\\\\\\\"", "\n\t", "'"}) {
            for (String key : new String[] {PW, TK, "api_key"}) {
                String value = "Zq9x" + middle + "K2mP7vL4Ab";
                hides(pair(key, R, "ok"), pair(key, value, "ok"));
            }
        }
    }

    @Test
    void escapedJsonInsideJsonStringsIsHiddenAtEveryDepth() {
        String value = "Zq9x\"K2mP7vL4Ab";
        String inner = pair(PW, value, "ok");
        hides("{\"args\":" + q(pair(PW, R, "ok")) + "}", "{\"args\":" + q(inner) + "}");
        String two = "{\"args\":" + q("{\"args\":" + q(inner) + "}") + "}";
        hides("{\"args\":" + q("{\"args\":" + q(pair(PW, R, "ok")) + "}") + "}", two);
    }

    @Test
    void valueEndingInBackslashStillCloses() {
        for (String tail : new String[] {"\\", "\\\\", "a\\"}) {
            String json = pair(TK, "Zq9x" + tail, "ok");
            hides(pair(TK, R, "ok"), json);
            hides("{\"args\":" + q(pair(TK, R, "ok")) + "}", "{\"args\":" + q(json) + "}");
        }
    }

    @Test
    void singleAndDoubleQuotedValuesWithEscapedQuotes() {
        hides("{'" + PW + "': '" + R + "', 'n': 1}", "{'" + PW + "': 'Zq9x\\'K2mP7vL4Ab', 'n': 1}");
        hides(PW + "='" + R + "' next", PW + "='Zq9x\\'K2mP7vL4Ab' next");
        hides(PW + "=\"" + R + "\" next", PW + "=\"Zq9x\\\"K2mP7vL4Ab\" next");
    }

    @Test
    void delimiterInsideAnUnquotedValue() {
        for (String d : new String[] {",", ";", "&", ")", "}"}) {
            hides(PW + "=" + R, PW + "=Zq9x" + d + "K2mP7vL4Ab");
            hides(PW + ": " + R + " done", PW + ": Zq9x" + d + "K2mP7vL4Ab done");
        }
        hides(TK + "=" + R + " next", TK + "=a1,b2 next");
        hides(PW + "=" + R + ",user=bob", PW + "=Zq9x,K2mP7vL4Ab,user=bob");
        hides("?" + PW + "=" + R + "&x=1", "?" + PW + "=Zq9x&K2mP7vL4Ab&x=1");
        hides("(" + PW + "=" + R + ").", "(" + PW + "=Zq9xK2mP7vL4Ab,R5tY).");
        for (String mid : new String[] {"\\", "\"x", "=y"}) {
            String out = scrub("login " + PW + "=Zq9xK2mP" + mid + "7vL4AbR5tY ok");
            assertFalse(out.contains("7vL4"), out);
            assertTrue(out.contains(" ok"), out);
        }
    }

    @Test
    void delimiterAtEverySplitPointLeaksNoFourCharacterWindow() {
        String secret = "Zq9xK2mP7vL4AbR5tY";
        String[][] forms = {
            {"login " + PW + "=", " ok"}, {"GET /x?" + PW + "=", " HTTP/1.1"},
            {"run --" + PW + "=", " --verbose"}, {"login " + PW + ": ", " ok"},
        };
        List<String> leaks = new ArrayList<>();
        int cases = 0;
        for (String[] form : forms) {
            for (String d : new String[] {",", ";", "&", ")", "}"}) {
                for (int at = 1; at < secret.length(); at++) {
                    String password = secret.substring(0, at) + d + secret.substring(at);
                    String out = scrub(form[0] + password + form[1]);
                    cases++;
                    for (int w = 0; w + 4 <= password.length(); w++) {
                        if (out.contains(password.substring(w, w + 4))) {
                            leaks.add(form[0] + password);
                            break;
                        }
                    }
                }
            }
        }
        assertEquals(4 * 17 * 5, cases);
        assertEquals(List.of(), leaks);
    }

    @Test
    void authorizationHeaders() {
        hides(R + "\nnext", "Authorization: Basic zzz\nnext");
        hides(R, "Proxy-Authorization: Bearer abc.def");
        hides("{\"Authorization\":\"" + R + "\",\"x\":1}", "{\"Authorization\":\"Bearer abc.def\",\"x\":1}");
        hides("\\\"Authorization\\\":\\\"" + R + "\\\"", "\\\"Authorization\\\":\\\"Bearer abc.def\\\"");
        hides("{\"Authorization\":\"" + R + "\",\"x\":1}", "{\"Authorization\":\"Digest u=1, r=2\",\"x\":1}");
        hides(R + "\nx", "Authorization: Digest u=1, r=" + HEX + "\nx");
        hides(R, "authorization=" + HEX + HEX + "==");
        same("Authorization: grants access");
    }

    @Test
    void bearerStrings() {
        hides("a " + R + " b", "a Bearer: " + HEX + " b");
        hides("a \"" + R + "\" b", "a Bearer \"" + HEX + "\" b");
        hides("Authorization header was " + R, "Authorization header was bearer 1234567890abc");
        same("bearer wisdom");
        same("bearer abcdefghij");
        hides(R, "bearer " + "x".repeat(20));
    }

    @Test
    void mcpTokenJwtAndPemAndUserinfo() {
        String mcp = String.join("-", "gmcp", "a1".repeat(32));
        hides("t=" + R + "!", "t=" + mcp + "!");
        same("gmcp-" + "a1".repeat(31));
        String jwt = String.join(".", "ey" + "JhbGciOiJIUzI1NiJ9", "ey" + "JzdWIiOiJ4eHh4eHgifQ", "c2lnbmF0dXJl");
        hides("tok " + R + " end", "tok " + jwt + " end");
        same("a.b.c");
        String glued = "x" + jwt;
        same(glued);
        String begin = "-----BEGIN " + "RSA PRIVATE" + " KEY-----";
        String end = "-----END " + "RSA PRIVATE" + " KEY-----";
        hides("before " + R + " after", "before " + begin + "\nMIIB\nabc\n" + end + " after");
        hides("before " + R, "before " + begin + "\nMIIB cut off");
        same("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----");
        String pw = String.join("", "p", "w");
        hides("https://" + R + "@host.example/path", "https://user:" + pw + "@host.example/path");
        hides("1.https://" + R + "@h", "1.https://u:" + pw + "@h");
        hides("-https://" + R + "@h", "-https://u:" + pw + "@h");
        hides("a".repeat(40) + "://" + R + "@h", "a".repeat(40) + "://u:" + pw + "@h");
        hides("http://" + R + "@host/x", "http://u:p@ss@host/x");
        same("http://user@host/x");
        same("mail a@b.example");
    }

    @Test
    void keyRuleUsesTheWordSplitOfKeyIsCredential() {
        for (String key : new String[] {"token", "access_token", "accessToken", "api-key", "apiKey", "API_KEY", "client.secret"}) {
            assertTrue(Redactor.keyIsCredential(key), key);
            assertTrue(CredentialKeys.isCredential(key), key);
        }
        for (String key : new String[] {"tokens", "max_tokens", "input_tokens", "key", "code", "sig", "pwd", "secretary", "cookies"}) {
            assertFalse(CredentialKeys.isCredential(key), key);
        }
        assertTrue(CredentialKeys.isCredential("sessionId"));
        assertTrue(CredentialKeys.isCredential("aws_secret_access_key"));
        assertTrue(CredentialKeys.isCookie("Set-Cookie"));
        assertFalse(CredentialKeys.isCookie("setCookie"));
    }

    @Test
    void addressesAreStillMaskedAlongsideCredentials() {
        hides("ip [addr] " + PW + "=" + R, "ip " + String.join(".", "10", "0", "0", "1") + " " + PW + "=Zq9xK2mP7vL4");
    }
}
