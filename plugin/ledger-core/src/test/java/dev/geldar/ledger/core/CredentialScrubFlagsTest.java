package dev.geldar.ledger.core;

import static dev.geldar.ledger.core.CredentialScrubTest.PW;
import static dev.geldar.ledger.core.CredentialScrubTest.R;
import static dev.geldar.ledger.core.CredentialScrubTest.SEC;
import static dev.geldar.ledger.core.CredentialScrubTest.TK;
import static dev.geldar.ledger.core.CredentialScrubTest.hides;
import static dev.geldar.ledger.core.CredentialScrubTest.same;
import static dev.geldar.ledger.core.CredentialScrubTest.scrub;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * PT-03n: port of telemetry/test/redact-gaps.test.ts (flag values, curl -u, URL query keys, AccountKey) and the
 * matching ordinary-text entries. Credential-shaped fixtures are built at run time.
 */
class CredentialScrubFlagsTest {
    private static final String PD = String.join("", "pass", "wd");
    private static final String AK = String.join("-", "api", "key");
    private static final String AK2 = String.join("", "api", "key");
    private static final String VAL = String.join("", "Zq9x", "K2mP7vL4Ab");
    private static final String LONG = String.join("", "Q7vL4Ab", "Zq9xK2mP7v", "Rt5");

    @Test
    void flagValueIsHiddenForEveryFlagName() {
        for (String name : new String[] {PW, PD, TK, SEC, AK, AK2, PW.toUpperCase()}) {
            hides("run --" + name + " " + R + " --verbose", "run --" + name + " " + VAL + " --verbose");
        }
    }

    @Test
    void flagValueQuotedBareAndAfterBlanks() {
        hides("x --" + PW + " \"" + R + "\" y", "x --" + PW + " \"open sesame\" y");
        hides("x --" + TK + " " + R + " y", "x --" + TK + " a1b2 y");
        hides("--" + TK + " " + R + ".", "--" + TK + " " + VAL + ".");
        hides("--" + PW + "  \t" + R, "--" + PW + "  \t" + VAL);
    }

    @Test
    void flagOrdinaryUsesStay() {
        for (String t : new String[] {
            "--" + PW + "-file /etc/x", "use --" + TK + " option", "--" + SEC + "-name abc", "--" + PW + " --verbose",
            "--" + PW + " north", "--" + TK + " 5", "--" + PW, "--" + PW + " ", "my--" + TK + " " + VAL,
            "-p " + VAL, "--" + PW + "s " + VAL, "--" + TK + VAL, "git push -u origin main"}) {
            same(t);
        }
    }

    @Test
    void curlUserKeepsTheNameAndHidesTheSecret() {
        hides("curl -u alice:" + R + " http://h/x", "curl -u alice:" + VAL + " http://h/x");
        hides("curl --user bob:" + R, "curl --user bob:" + VAL);
        hides("curl -u \"carol:" + R + "\" h", "curl -u \"carol:" + VAL + "\" h");
    }

    @Test
    void curlUserOrdinaryUsesStay() {
        for (String t : new String[] {
            "git push -u origin:main", "curl -u alice", "curl -u alice:", "curl -u :north", "curl -u http://host/path",
            "curl -u origin:/refs/heads/x", "curl -U alice:" + VAL, "curl -ux alice:abc"}) {
            same(t);
        }
    }

    @Test
    void querySigAndAmzKeysAreAlwaysHidden() {
        for (String url : new String[] {
            "https://h/p?sig=" + VAL, "https://h/p?a=1&sig=" + VAL, "https://h/p?X-Amz-Credential=" + VAL,
            "https://h/p?a=1&X-Amz-Signature=" + VAL, "https://h/p?sig=abc", "https://h/p?Signature=" + VAL}) {
            String out = scrub(url);
            assertTrue(out.contains(R), out);
            assertFalse(out.contains("Zq9x") || out.contains("abc"), out);
        }
        hides("https://h/p?sig=" + R + "&page=2", "https://h/p?sig=" + VAL + "&page=2");
        hides("?X-Amz-Credential=" + R + "&X-Amz-Date=1", "?X-Amz-Credential=a%2Fb&X-Amz-Date=1");
    }

    @Test
    void accountKeyIsHidden() {
        String b64 = LONG + "+/" + VAL + "==";
        hides("DefaultEndpointsProtocol=https;AccountKey=" + R + ";EndpointSuffix=x",
                "DefaultEndpointsProtocol=https;AccountKey=" + b64 + ";EndpointSuffix=x");
        hides("account_key=" + R, "account_key=" + b64);
    }

    @Test
    void queryKeyAndCodeNeedALongSecretValue() {
        hides("https://h/p?key=" + R, "https://h/p?key=" + LONG);
        hides("https://h/p?a=1&code=" + R + "&b=2", "https://h/p?a=1&code=" + LONG + "&b=2");
        for (String t : new String[] {
            "https://h/p?code=404", "https://h/p?key=name", "https://h/p?key=abc123", "key=" + LONG, "code: " + LONG,
            "https://h/p/key=" + LONG, "https://h/p?monkey=" + LONG, "the sig of the sword", "sig", "sig=abc",
            "signal=abcdefghij", "https://h/p?sigma=abcdefghij", "https://h/p?code=northwestern",
            "?code=404", "?key=name"}) {
            same(t);
        }
    }

    @Test
    void sshPublicKeysStay() {
        same("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI" + VAL + " user@host");
    }

    @Test
    void credentialKeyWordsMatchTheTypeScriptSet() {
        for (String k : new String[] {"auth", "session_id", "jwt", "access_key", "signing_key", "ssh_key", "AccountKey",
            "private_key", "secret_key", "api_key", "sessionId"}) {
            assertTrue(CredentialKeys.isCredential(k), k);
        }
        for (String k : new String[] {"secretary", "cookies", "tokens", "account", "session", "monkey"}) {
            assertFalse(CredentialKeys.isCredential(k), k);
        }
    }
}
