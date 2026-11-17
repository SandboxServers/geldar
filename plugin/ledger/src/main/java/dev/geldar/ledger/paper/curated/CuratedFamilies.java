package dev.geldar.ledger.paper.curated;

import java.util.ArrayList;
import java.util.List;

/**
 * The curated families by class name, resolved with {@code Class.forName} like {@code PaperCollectors}: a class that does
 * not exist yet (its card has not landed) is skipped. PT-07b to PT-07f each add only their own class.
 */
final class CuratedFamilies {
    private static final String PKG = "dev.geldar.ledger.paper.curated.";

    static final List<String> NAMES = List.of(
            PKG + "BlocksItemsFamily",
            PKG + "ContainersSleepAnimalsFamily",
            PKG + "CombatMovementFamily",
            PKG + "TextContentFamily",
            PKG + "OperatorAuditFamily",
            PKG + "MiscFamily");

    private CuratedFamilies() {}

    /** Builds every family that exists and has a public no-argument constructor; the others are skipped. */
    static List<CuratedFamily> load(ClassLoader loader) {
        List<CuratedFamily> out = new ArrayList<>();
        for (String name : NAMES) {
            try {
                Class<?> cls = Class.forName(name, true, loader);
                if (CuratedFamily.class.isAssignableFrom(cls)) {
                    out.add((CuratedFamily) cls.getDeclaredConstructor().newInstance());
                }
            } catch (Throwable t) {
                // absent or broken: skipped, the other families are unaffected (S8)
            }
        }
        return out;
    }
}
