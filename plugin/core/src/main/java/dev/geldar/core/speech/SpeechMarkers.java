package dev.geldar.core.speech;

import com.flowpowered.math.vector.Vector3d;
import de.bluecolored.bluemap.api.BlueMapAPI;
import de.bluecolored.bluemap.api.BlueMapMap;
import de.bluecolored.bluemap.api.markers.HtmlMarker;
import de.bluecolored.bluemap.api.markers.MarkerSet;
import java.util.List;
import org.bukkit.Bukkit;
import org.bukkit.World;

/**
 * The BlueMap side of the speech bubbles. Every map of a world gets the marker set {@link #SET_ID} with one
 * HtmlMarker per live bubble of that world, so an empty list clears the set. Loaded only when BlueMap is enabled.
 * Does nothing until BlueMap has enabled (attach) and again after it disables (detach).
 */
final class SpeechMarkers implements SpeechBubbles.Renderer {
    /** The marker set's id on every map; operators hide it by this name (docs/runbooks/skins.md, BlueMap section). */
    static final String SET_ID = "geldar-speech";
    static final String SET_LABEL = "Speech";
    static final String MARKER_PREFIX = "bubble-";

    private volatile BlueMapAPI api;

    void attach(BlueMapAPI blueMap) {
        this.api = blueMap;
    }

    void detach() {
        this.api = null;
    }

    @Override
    public void render(List<SpeechBubbles.Placed> bubbles) {
        BlueMapAPI current = api;
        if (current == null) {
            return;
        }
        for (World world : Bukkit.getWorlds()) {
            current.getWorld(world).ifPresent(blueWorld -> {
                for (BlueMapMap map : blueWorld.getMaps()) {
                    map.getMarkerSets().put(SET_ID, markerSet(world, bubbles));
                }
            });
        }
    }

    private static MarkerSet markerSet(World world, List<SpeechBubbles.Placed> bubbles) {
        // Toggleable, shown by default (not hidden): viewers can switch the layer off on the map.
        MarkerSet set = new MarkerSet(SET_LABEL, true, false);
        for (SpeechBubbles.Placed bubble : bubbles) {
            if (bubble.world().equals(world)) {
                Vector3d at = new Vector3d(bubble.x(), bubble.y(), bubble.z());
                set.put(MARKER_PREFIX + bubble.agent(), new HtmlMarker(SET_LABEL, at, bubble.html()));
            }
        }
        return set;
    }
}
