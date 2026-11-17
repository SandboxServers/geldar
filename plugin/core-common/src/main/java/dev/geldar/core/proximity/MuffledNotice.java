package dev.geldar.core.proximity;

/**
 * The heard_muffled notice (decision 0199, steps 6 and 9): a direction and a distance band, as heard_sound gives them,
 * and nothing else. The direction is a compass point, or "overhead" or "below" for a voice straight above or below.
 * The JSON is built from enumerated codes only; no coordinates, speaker or words.
 */
public record MuffledNotice(String direction, String band) {
    private static final String[] POINTS = {"n", "ne", "e", "se", "s", "sw", "w", "nw"};

    /**
     * The direction FROM the listener TOWARD the speaker, from the offsets dx = speaker.x - listener.x,
     * dy = speaker.y - listener.y and dz = speaker.z - listener.z. When both horizontal offsets are under 1 block
     * (|dx| &lt; 1 and |dz| &lt; 1) the voice is straight above or below: "overhead" if dy &gt;= 0, else "below".
     * Otherwise it is the compass point. North is -z, east is +x (the convention of golem's sounds.ts pointOf).
     */
    public static String direction(double dx, double dy, double dz) {
        if (Math.abs(dx) < 1 && Math.abs(dz) < 1) {
            return dy >= 0 ? "overhead" : "below";
        }
        int index = (int) Math.round(Math.atan2(dx, -dz) / (Math.PI / 4));
        return POINTS[((index % 8) + 8) % 8];
    }

    /**
     * The distance band of a raw 3D distance: near up to 8 blocks, mid up to 16, far beyond that. heard_sound's
     * bands stop at 24 (its radius); a muffled voice reaches 32 raw, so 24 to 32 falls in far (MH-3 choice).
     */
    public static String band(double rawDistance) {
        if (rawDistance <= 8) {
            return "near";
        }
        if (rawDistance <= 16) {
            return "mid";
        }
        return "far";
    }

    /**
     * The notice from the speaker's and the listener's feet, the y offset dy = speaker.y - listener.y, and the raw
     * distance between them.
     */
    public static MuffledNotice of(double speakerX, double speakerZ, double listenerX, double listenerZ, double dy,
            double raw) {
        return new MuffledNotice(direction(speakerX - listenerX, dy, speakerZ - listenerZ), band(raw));
    }

    /**
     * The payload: {@code {"kind":"heard_muffled","direction":"w","band":"far"}}. The direction is one of the eight
     * compass points, or "overhead" or "below" (see {@link #direction}); the band is near, mid or far.
     */
    public String json() {
        return "{\"kind\":\"heard_muffled\",\"direction\":\"" + direction + "\",\"band\":\"" + band + "\"}";
    }
}
