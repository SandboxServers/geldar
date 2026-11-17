package dev.geldar.ledger.neoforge.server;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

class JvmHeapTest {
    @Test
    void lastXmxWins() {
        assertEquals("8G", JvmHeap.describe(List.of("-Xmx2G", "-Dfoo=bar", "-Xmx8G")));
    }

    @Test
    void maxHeapSizeCountsAndLastOfEitherWins() {
        assertEquals("4G", JvmHeap.describe(List.of("-XX:MaxHeapSize=4G")));
        assertEquals("6G", JvmHeap.describe(List.of("-Xmx2G", "-XX:MaxHeapSize=6G")));
        assertEquals("2G", JvmHeap.describe(List.of("-XX:MaxHeapSize=6G", "-Xmx2G")));
    }

    @Test
    void percentOnlyIsReportedAsPercentAndLastWins() {
        assertEquals("MaxRAMPercentage=75", JvmHeap.describe(List.of("-XX:MaxRAMPercentage=50", "-XX:MaxRAMPercentage=75")));
    }

    @Test
    void anExplicitSizeBeatsAPercent() {
        assertEquals("3G", JvmHeap.describe(List.of("-XX:MaxRAMPercentage=75", "-Xmx3G")));
    }

    @Test
    void nothingKnownIsUnknownNotDefault() {
        assertEquals("unknown", JvmHeap.describe(List.of()));
        assertEquals("unknown", JvmHeap.describe(List.of("-Xmx", "-XX:MaxRAMPercentage=", "-Xms1G")));
    }
}