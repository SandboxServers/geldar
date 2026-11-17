package dev.geldar.core.kino;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Base64;
import org.junit.jupiter.api.Test;

class PaletteEncoderTest {
    /** 2^bits distinct states (one for bits 0), cell i holding (i * 7 + 3) mod n so every state is used. */
    private static String[] cells(int bits) {
        int n = 1 << bits;
        String[] c = new String[4096];
        for (int i = 0; i < 4096; i++) {
            c[i] = "minecraft:b" + (i < n ? i : (i * 7 + 3) % n);
        }
        return c;
    }

    /** Reads cell i straight from the documented packing: bit k of the stream is bit (k mod 8) of byte k / 8. */
    private static int decode(byte[] data, int bits, int i) {
        int v = 0;
        for (int j = 0; j < bits; j++) {
            int k = i * bits + j;
            v |= (data[k >> 3] >> (k & 7) & 1) << j;
        }
        return v;
    }

    @Test
    void roundTripsForEveryBitWidthFrom0To12AndValidates() {
        for (int bits = 0; bits <= 12; bits++) {
            String[] c = cells(bits);
            PaletteEncoder.Encoded e = PaletteEncoder.encode(c);
            assertEquals(bits, e.bits(), "bits for " + bits);
            assertEquals(1 << bits, e.palette().size());
            byte[] data = Base64.getDecoder().decode(e.data());
            assertEquals((4096 * bits + 7) / 8, data.length);
            for (int i = 0; i < 4096; i++) {
                assertEquals(c[i], e.palette().get(decode(data, bits, i)), "bits " + bits + " cell " + i);
            }
            String json = KinoMessages.chunkSection(-3, 5, -2, e);
            assertTrue(KinoSchemaCheck.errors(json).isEmpty(), bits + ": " + KinoSchemaCheck.errors(json));
        }
    }

    @Test
    void bitsIsTheSmallestWidthHoldingThePalette() {
        assertEquals(0, PaletteEncoder.bitsFor(1));
        assertEquals(1, PaletteEncoder.bitsFor(2));
        assertEquals(2, PaletteEncoder.bitsFor(3));
        assertEquals(2, PaletteEncoder.bitsFor(4));
        assertEquals(3, PaletteEncoder.bitsFor(5));
        assertEquals(12, PaletteEncoder.bitsFor(4096));
    }

    @Test
    void cellOrderIsYThenZThenXLeastSignificantBitFirst() {
        String[] c = new String[4096];
        java.util.Arrays.fill(c, "minecraft:air");
        c[1] = "minecraft:stone";
        PaletteEncoder.Encoded e = PaletteEncoder.encode(c);
        assertEquals(1, e.bits());
        assertEquals(0b10, Base64.getDecoder().decode(e.data())[0]);
    }

    @Test
    void stateKeysAreSorted() {
        assertEquals("minecraft:x[a=1,b=2]", PaletteEncoder.normalize("minecraft:x[b=2,a=1]"));
        assertEquals("minecraft:stone", PaletteEncoder.normalize("minecraft:stone"));
    }
}