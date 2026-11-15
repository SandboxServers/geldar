package dev.geldar.core.proximity;

/**
 * The heard_muffled notice (decision 0199, steps 6 and 9): a compass direction and a distance band, as heard_sound
 * gives them, and nothing else. The JSON is built from enumerated codes only; no coordinates, speaker or words.
 */
public record MuffledNotice(String direction, String band) {
    private static final String[] POINTS = {"n", "ne", "e", "se", "s", "sw", "w", "nw"};

    /**
     * The compass point FROM the listener TOWARD the speaker, from the offset dx = speaker.x - listener.x and
     * dz = speaker.z - listener.z. North is -z, east is +x (the convention of golem's sounds.ts pointOf).
     */
    public static String direction(double dx, double dz) {
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

    /** The notice from the listener's and the speaker's feet and the raw distance between them. */
    public static MuffledNotice of(double speakerX, double speakerZ, double listenerX, double listenerZ, double raw) {
        return new MuffledNotice(direction(speakerX - listenerX, speakerZ - listenerZ), band(raw));
    }

    /** The payload: {@code {"kind":"heard_muffled","direction":"w","band":"far"}}. */
    public String json() {
        return "{\"kind\":\"heard_muffled\",\"direction\":\"" + direction + "\",\"band\":\"" + band + "\"}";
    }
}
