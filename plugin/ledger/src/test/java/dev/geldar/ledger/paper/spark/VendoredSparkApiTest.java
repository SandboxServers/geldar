package dev.geldar.ledger.paper.spark;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.junit.jupiter.api.Test;

class VendoredSparkApiTest {
    @Test
    void vendoredJarHasTheRecordedSha256() throws Exception {
        Path jar = Path.of("libs", "spark-api-0.1-20260912.112908-2.jar");
        byte[] bytes = Files.readAllBytes(jar);
        assertEquals(11_588, bytes.length);
        assertEquals(
                "e4856b0d2ba56db652ca340821a5b40ad0bdd192cf77707ba0f4557eeb5cb63d",
                HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)));
    }
}
