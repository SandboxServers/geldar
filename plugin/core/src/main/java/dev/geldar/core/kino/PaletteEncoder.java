package dev.geldar.core.kino;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The palette-v1 section encoding of kino-feed.schema.json: 4096 cells in order (y * 16 + z) * 16 + x, a
 * palette of distinct states in first-seen order, indices packed least significant bit first.
 */
public final class PaletteEncoder {
    public static final int CELLS = 4096;

    private PaletteEncoder() {}

    public record Encoded(List<String> palette, int bits, String data) {}

    /** The smallest b with 2^b >= n. */
    public static int bitsFor(int paletteSize) {
        int b = 0;
        while ((1 << b) < paletteSize) {
            b++;
        }
        return b;
    }

    public static Encoded encode(String[] cells) {
        if (cells.length != CELLS) {
            throw new IllegalArgumentException("a section has 4096 cells, got " + cells.length);
        }
        Map<String, Integer> palette = new LinkedHashMap<>();
        int[] index = new int[CELLS];
        for (int i = 0; i < CELLS; i++) {
            index[i] = palette.computeIfAbsent(cells[i], k -> palette.size());
        }
        int bits = bitsFor(palette.size());
        byte[] out = new byte[(CELLS * bits + 7) / 8];
        for (int i = 0; i < CELLS; i++) {
            for (int j = 0; j < bits; j++) {
                if ((index[i] >> j & 1) != 0) {
                    int k = i * bits + j;
                    out[k >> 3] |= (byte) (1 << (k & 7));
                }
            }
        }
        return new Encoded(new ArrayList<>(palette.keySet()), bits, Base64.getEncoder().encodeToString(out));
    }

    /** Puts the state keys of {@code ns:id[k=v,...]} in sorted order, as the schema requires. */
    public static String normalize(String state) {
        int open = state.indexOf('[');
        if (open < 0 || !state.endsWith("]")) {
            return state;
        }
        String[] pairs = state.substring(open + 1, state.length() - 1).split(",");
        Arrays.sort(pairs);
        return state.substring(0, open) + "[" + String.join(",", pairs) + "]";
    }
}