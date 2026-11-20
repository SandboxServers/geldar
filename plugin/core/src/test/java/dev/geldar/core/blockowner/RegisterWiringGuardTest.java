package dev.geldar.core.blockowner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Pins the provenance wiring of {@code BlockOwnerSetup.register} by source text, since {@code register} needs a Bukkit
 * server and no unit test calls it. {@link #violations} reads {@code BlockOwnerSetup.java} only: {@code register}, the
 * seam bodies and {@code reload}. {@link #foreignConstructions} is run over every other main source. Both normalise the
 * text first ({@link #strip} removes comments and empties literals, {@link #flat} collapses whitespace), so spacing,
 * line breaks, comments and fully qualified names do not hide a construction.
 */
class RegisterWiringGuardTest {
    /**
     * A seam that {@code register} calls: the position (0-based) of its gate argument, and the gate expression that
     * argument must be.
     */
    private record Seam(String name, int gateIndex, String gate) {}

    /**
     * The seams {@code register} calls. To add one (AN-50a: containerTakeListener, {@code new Seam("containerTakeListener",
     * 2, "setup.gate::on")}), append one line here and add its constructor to LISTENER_CTORS. The combat-fact seam is NOT
     * here: it is read from GeldarCore.onEnable, which this guard does not scan (see the worknote, AN-50a must add that).
     */
    private static final List<Seam> SEAMS =
            List.of(new Seam("breakListener", 4, "setup.gate"), new Seam("pickupListener", 1, "setup.gate"));

    /**
     * The listener constructors only a seam may build, in any spelling. AN-50a adds ContainerTakeListener and
     * CombatFactListener here, one line each, when they are registered.
     */
    private static final List<String> LISTENER_CTORS = List.of("BlockChangeListener", "PickupProvenanceListener");

    /** The files that define the listeners, and BlockOwnerSetup, which {@link #violations} checks on its own. */
    private static final Set<String> OWN_FILES =
            Set.of("BlockChangeListener.java", "PickupProvenanceListener.java", "BlockOwnerSetup.java");

    private static final Path SOURCE = Path.of("src/main/java/dev/geldar/core/blockowner/BlockOwnerSetup.java");
    private static final Path MAIN = Path.of("src/main/java");
    private static final Pattern REGISTER = Pattern.compile("\\n {4}public static BlockOwnerSetup register\\(");
    private static final Pattern RELOAD = Pattern.compile("\\n {4}public void reload\\(");
    private static final String END = "\n    }\n";

    private static final String GOOD_REGISTER =
            "        manager.registerEvents(breakListener(cache, publisher, () -> setup.enabled, link,"
            + " setup.gate, tick), plugin);\n"
            + "        manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n";
    private static final String GOOD_BREAK =
            "        return new BlockChangeListener(cache, publisher, enabled, sink, gate::on, tick);\n";
    private static final String GOOD_PICKUP = "        return new PickupProvenanceListener(sink, gate::on, tick, online);\n";
    private static final String GOOD_RELOAD =
            "        gate.reload(config);\n"
            + "        enabled = config.getBoolean(\"blockowner.enabled\", true);\n";

    /** The text of the method declared by {@code declaration}, through its closing four-space brace; null if absent. */
    private static String method(String source, Pattern declaration) {
        Matcher m = declaration.matcher(source);
        if (!m.find()) {
            return null;
        }
        int end = source.indexOf(END, m.start());
        return end < 0 ? null : source.substring(m.start(), end + END.length());
    }

    /** A seam declaration: four-space indent, optional {@code public}, then {@code static}. */
    private static Pattern seamDeclaration(String name) {
        return Pattern.compile("\\n {4}(?:public )?static [\\w.<>]+ " + Pattern.quote(name) + "\\(");
    }

    /** The top-level argument lists of each call to {@code name} in {@code body}, each argument trimmed. */
    private static List<List<String>> callsOf(String body, String name) {
        List<List<String>> calls = new ArrayList<>();
        Matcher m = Pattern.compile("\\b" + Pattern.quote(name) + "\\s*\\(").matcher(body);
        while (m.find()) {
            int depth = 1;
            List<String> args = new ArrayList<>();
            StringBuilder arg = new StringBuilder();
            int i = m.end();
            for (; i < body.length() && depth > 0; i++) {
                char c = body.charAt(i);
                if (c == '(') {
                    depth++;
                } else if (c == ')') {
                    depth--;
                }
                if (depth == 0) {
                    break;
                }
                if (c == ',' && depth == 1) {
                    args.add(arg.toString().trim());
                    arg.setLength(0);
                } else {
                    arg.append(c);
                }
            }
            if (depth == 0) {
                args.add(arg.toString().trim());
                calls.add(args);
            }
        }
        return calls;
    }

    /**
     * The source with comments removed and string and char literals emptied. Line breaks are kept, so the line-anchored
     * method patterns still match.
     */
    static String strip(String src) {
        StringBuilder out = new StringBuilder(src.length());
        int i = 0;
        while (i < src.length()) {
            if (src.startsWith("//", i)) {
                int end = src.indexOf('\n', i);
                i = end < 0 ? src.length() : end;
            } else if (src.startsWith("/*", i)) {
                int end = src.indexOf("*/", i + 2);
                int stop = end < 0 ? src.length() : end + 2;
                out.append(' ').append(src.substring(i, stop).replaceAll("[^\n]", ""));
                i = stop;
            } else if (src.startsWith("\"\"\"", i)) {
                int end = src.indexOf("\"\"\"", i + 3);
                int stop = end < 0 ? src.length() : end + 3;
                out.append("\"\"").append(src.substring(i, stop).replaceAll("[^\n]", ""));
                i = stop;
            } else if (src.charAt(i) == '"' || src.charAt(i) == '\'') {
                char quote = src.charAt(i);
                int j = i + 1;
                while (j < src.length() && src.charAt(j) != quote && src.charAt(j) != '\n') {
                    j += src.charAt(j) == '\\' ? 2 : 1;
                }
                out.append(quote).append(quote);
                i = j + 1;
            } else {
                out.append(src.charAt(i));
                i++;
            }
        }
        return out.toString();
    }

    /** Collapses every run of whitespace to one space, so a construction split by a line break still matches. */
    static String flat(String code) {
        return code.replaceAll("\\s+", " ").trim();
    }

    /** True when the flattened {@code code} builds {@code type} or takes its constructor as a method reference. */
    static boolean constructs(String code, String type) {
        String name = Pattern.quote(type);
        return Pattern.compile("\\bnew\\s+(?:[\\w.]+\\.)?" + name + "\\s*\\(").matcher(code).find()
                || Pattern.compile("\\b(?:[\\w.]+\\.)?" + name + "\\s*::\\s*new\\b").matcher(code).find();
    }

    /** True when the flattened {@code arg} is a seam call, or a variable that {@code register} assigns from one. */
    private static boolean isSeamResult(String arg, String register, List<Seam> seams) {
        for (Seam seam : seams) {
            if (arg.matches(Pattern.quote(seam.name()) + "\\s*\\(.*\\)")) {
                return true;
            }
        }
        if (arg.matches("\\w+")) {
            for (Seam seam : seams) {
                String assigned = "\\b" + arg + "\\s*=\\s*" + Pattern.quote(seam.name()) + "\\s*\\(";
                if (Pattern.compile(assigned).matcher(register).find()) {
                    return true;
                }
            }
        }
        return false;
    }

    /** What is wrong with the wiring in {@code source}; empty when the guard holds. */
    static List<String> violations(String source) {
        return violations(source, SEAMS);
    }

    /** What is wrong with the wiring in {@code source} against {@code seams}; empty when the guard holds. */
    static List<String> violations(String source, List<Seam> seams) {
        List<String> out = new ArrayList<>();
        String code = strip(source);
        String register = method(code, REGISTER);
        if (register == null) {
            out.add("register() not found");
            return out;
        }
        if (constructs(flat(register), "ProvenanceGate")) {
            out.add("register() builds its own ProvenanceGate");
        }
        int seamCalls = 0;
        String outsideSeams = code;
        for (Seam seam : seams) {
            String seamBody = method(code, seamDeclaration(seam.name()));
            if (seamBody == null) {
                out.add(seam.name() + "( seam not found");
                continue;
            }
            outsideSeams = outsideSeams.replace(seamBody, "");
            List<List<String>> calls = callsOf(register, seam.name());
            seamCalls += calls.size();
            if (calls.isEmpty()) {
                out.add("register() does not call " + seam.name() + "(");
            }
            for (List<String> args : calls) {
                if (args.size() <= seam.gateIndex() || !seam.gate().equals(flat(args.get(seam.gateIndex())))) {
                    out.add("register() passes " + seam.name() + "( something other than " + seam.gate()
                            + " as argument " + seam.gateIndex());
                }
            }
        }
        List<List<String>> registrations = callsOf(register, "registerEvents");
        for (List<String> args : registrations) {
            String first = flat(args.get(0));
            if (!isSeamResult(first, register, seams)) {
                out.add("register() registers something other than a seam result: " + first);
            }
        }
        if (seamCalls != registrations.size()) {
            out.add("register() has " + seamCalls + " seam call(s) but " + registrations.size()
                    + " registerEvents( call(s): a seam result is discarded or not registered");
        }
        for (String ctor : LISTENER_CTORS) {
            if (constructs(flat(outsideSeams), ctor)) {
                out.add("new " + ctor + "( outside a seam");
            }
        }
        String reload = method(code, RELOAD);
        if (reload == null || !flat(reload).contains("gate.reload(config);")) {
            out.add("reload() does not call gate.reload(config)");
        }
        return out;
    }

    /** The listener constructions in a main source other than BlockOwnerSetup; any at all is a violation. */
    static List<String> foreignConstructions(String fileName, String source) {
        String code = flat(strip(source));
        List<String> out = new ArrayList<>();
        for (String ctor : LISTENER_CTORS) {
            if (constructs(code, ctor)) {
                out.add(fileName + " builds " + ctor);
            }
        }
        return out;
    }

    private static String source(String registerBody, String breakSeam, String pickupSeam) {
        return "\n    public static BlockOwnerSetup register(JavaPlugin plugin) {\n" + registerBody + END
                + "    static BlockChangeListener breakListener(OwnerCache cache) {\n" + breakSeam + END
                + "\n    static PickupProvenanceListener pickupListener(ProvenanceSink sink) {\n" + pickupSeam + END
                + "\n    public void reload(FileConfiguration config) {\n" + GOOD_RELOAD + END;
    }

    @Test
    @DisplayName("register() hands setup.gate to every seam, builds no listener itself, and reload() feeds the gate")
    void registerHandsGateToEverySeam() throws IOException {
        assertEquals(List.of(), violations(Files.readString(SOURCE)));
    }

    @Test
    @DisplayName("no main source other than BlockOwnerSetup, BlockChangeListener and PickupProvenanceListener builds a listener")
    void noOtherMainSourceBuildsAListener() throws IOException {
        List<String> found = new ArrayList<>();
        try (Stream<Path> files = Files.walk(MAIN)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = file.getFileName().toString();
                if (!OWN_FILES.contains(name)) {
                    found.addAll(foreignConstructions(name, Files.readString(file)));
                }
            }
        }
        assertEquals(List.of(), found);
    }

    @Test
    @DisplayName("the guard accepts a synthetic source that follows the pattern")
    void guardAcceptsSyntheticGoodSource() {
        assertEquals(List.of(), violations(source(GOOD_REGISTER, GOOD_BREAK, GOOD_PICKUP)));
    }

    @Test
    @DisplayName("the guard names a direct BlockChangeListener built in register()")
    void guardCatchesDirectBreakListener() {
        String direct = "        manager.registerEvents(new BlockChangeListener(cache, publisher, () -> setup.enabled, link,"
                + " () -> setup.enabled, tick), plugin);\n"
                + "        manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n";
        List<String> found = violations(source(direct, GOOD_BREAK, GOOD_PICKUP));
        assertTrue(found.contains("new BlockChangeListener( outside a seam"), found.toString());
        assertTrue(found.contains("register() does not call breakListener("), found.toString());
    }

    @Test
    @DisplayName("the guard names a direct PickupProvenanceListener built in register()")
    void guardCatchesDirectPickupListener() {
        String direct = "        manager.registerEvents(breakListener(cache, publisher, () -> setup.enabled, link, setup.gate,"
                + " tick), plugin);\n"
                + "        manager.registerEvents(new PickupProvenanceListener(link, () -> setup.enabled, tick, online),"
                + " plugin);\n";
        List<String> found = violations(source(direct, GOOD_BREAK, GOOD_PICKUP));
        assertTrue(found.contains("new PickupProvenanceListener( outside a seam"), found.toString());
        assertTrue(found.contains("register() does not call pickupListener("), found.toString());
    }

    @Test
    @DisplayName("the guard names a seam called with a fresh ProvenanceGate instead of setup.gate")
    void guardCatchesFreshGateArgument() {
        String fresh = GOOD_REGISTER.replace("link, setup.gate, tick, online", "link, new ProvenanceGate(), tick, online");
        List<String> found = violations(source(fresh, GOOD_BREAK, GOOD_PICKUP));
        assertTrue(found.stream().anyMatch(v -> v.startsWith("register() passes pickupListener(")), found.toString());
        assertTrue(found.contains("register() builds its own ProvenanceGate"), found.toString());
    }

    @Test
    @DisplayName("the guard names a seam that register() no longer has")
    void guardCatchesMissingSeam() {
        String noBreakSeam = source(GOOD_REGISTER, GOOD_BREAK, GOOD_PICKUP).replace(
                "    static BlockChangeListener breakListener(OwnerCache cache) {\n", "    static Object renamed(OwnerCache cache) {\n");
        List<String> found = violations(noBreakSeam);
        assertTrue(found.contains("breakListener( seam not found"), found.toString());
    }

    @Test
    @DisplayName("the guard names a spaced constructor (new X (...)) registered in register()")
    void guardCatchesSpacedConstructor() {
        String spaced = GOOD_REGISTER.replace("manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n",
                "manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n"
                + "        manager.registerEvents(new PickupProvenanceListener (link, () -> setup.enabled,"
                + " Bukkit::getCurrentTick, Bukkit::getPlayer), plugin);\n");
        List<String> found = violations(source(spaced, GOOD_BREAK, GOOD_PICKUP));
        assertTrue(found.contains("new PickupProvenanceListener( outside a seam"), found.toString());
        assertTrue(found.stream().anyMatch(v -> v.startsWith("register() registers something other than a seam result")),
                found.toString());
    }

    @Test
    @DisplayName("the guard names a constructor split across a line break")
    void guardCatchesNewlineConstructor() {
        String split = GOOD_REGISTER.replace("manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n",
                "manager.registerEvents(new BlockChangeListener\n            (cache, publisher, enabled, link, gate::on, tick), plugin);\n");
        assertTrue(violations(source(split, GOOD_BREAK, GOOD_PICKUP)).contains("new BlockChangeListener( outside a seam"));
    }

    @Test
    @DisplayName("the guard names a fully qualified constructor")
    void guardCatchesFullyQualifiedConstructor() {
        String qualified = GOOD_REGISTER.replace("manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n",
                "manager.registerEvents(new dev.geldar.core.blockowner.PickupProvenanceListener(link, () -> setup.enabled,"
                + " tick, online), plugin);\n");
        assertTrue(violations(source(qualified, GOOD_BREAK, GOOD_PICKUP)).contains("new PickupProvenanceListener( outside a seam"));
    }

    @Test
    @DisplayName("the guard names a constructor method reference (X::new)")
    void guardCatchesMethodReference() {
        String reference = GOOD_REGISTER + "        Object make = BlockChangeListener::new;\n";
        assertTrue(violations(source(reference, GOOD_BREAK, GOOD_PICKUP)).contains("new BlockChangeListener( outside a seam"));
    }

    @Test
    @DisplayName("the guard names a constructor in a helper method elsewhere in BlockOwnerSetup")
    void guardCatchesHelperMethod() {
        String helper = source(GOOD_REGISTER, GOOD_BREAK, GOOD_PICKUP)
                + "\n    private static Object helper(Object a) {\n        return new BlockChangeListener (a);\n    }\n";
        assertTrue(violations(helper).contains("new BlockChangeListener( outside a seam"));
    }

    @Test
    @DisplayName("the guard names a seam result discarded while its listener is built directly")
    void guardCatchesDiscardedSeamResult() {
        String discarded = "        breakListener(cache, publisher, () -> setup.enabled, link, setup.gate, tick);\n"
                + "        manager.registerEvents(new BlockChangeListener(cache, publisher, () -> setup.enabled, link,"
                + " () -> setup.enabled, tick), plugin);\n"
                + "        manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n";
        List<String> found = violations(source(discarded, GOOD_BREAK, GOOD_PICKUP));
        assertTrue(found.contains("new BlockChangeListener( outside a seam"), found.toString());
        assertTrue(found.contains("register() registers something other than a seam result: new BlockChangeListener("
                + "cache, publisher, () -> setup.enabled, link, () -> setup.enabled, tick)"), found.toString());
    }

    @Test
    @DisplayName("a listener register() registers from an unassigned variable is named")
    void guardCatchesUnassignedVariable() {
        String variable = GOOD_REGISTER + "        manager.registerEvents(listener, plugin);\n";
        assertTrue(violations(source(variable, GOOD_BREAK, GOOD_PICKUP))
                .contains("register() registers something other than a seam result: listener"));
    }

    @Test
    @DisplayName("a seam result held in a variable that register() assigns from the seam is accepted")
    void guardAcceptsSeamResultInVariable() {
        String variable = "        var seam = breakListener(cache, publisher, () -> setup.enabled, link, setup.gate, tick);\n"
                + "        manager.registerEvents(seam, plugin);\n"
                + "        manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n";
        assertEquals(List.of(), violations(source(variable, GOOD_BREAK, GOOD_PICKUP)));
    }

    @Test
    @DisplayName("constructs hidden by comments are still named, and a comment or string that mentions one is not")
    void guardReadsCodeNotComments() {
        String hidden = "        // manager.registerEvents(breakListener(cache, publisher, () -> setup.enabled, link, setup.gate,"
                + " tick), plugin);\n"
                + "        // manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n"
                + "        manager.registerEvents(new BlockChangeListener (cache, publisher, enabled, link, gate::on, tick),"
                + " plugin);\n"
                + "        manager.registerEvents(new /* hidden */ PickupProvenanceListener(link, () -> setup.enabled,"
                + " tick, online), plugin);\n";
        List<String> found = violations(source(hidden, GOOD_BREAK, GOOD_PICKUP));
        assertTrue(found.contains("register() does not call breakListener("), found.toString());
        assertTrue(found.contains("new BlockChangeListener( outside a seam"), found.toString());
        assertTrue(found.contains("new PickupProvenanceListener( outside a seam"), found.toString());

        String mentioned = GOOD_REGISTER + "        // a note: new BlockChangeListener(cache) is built only by breakListener\n";
        String helper = "\n    private static String doc() {\n        return \"new BlockChangeListener(\";\n    }\n";
        assertEquals(List.of(), violations(source(mentioned, "        // new BlockChangeListener(x) is documented here\n"
                + GOOD_BREAK, GOOD_PICKUP) + helper));
    }

    @Test
    @DisplayName("the guard names a reload() that no longer feeds the gate")
    void guardCatchesReloadWithoutGate() {
        String noGate = source(GOOD_REGISTER, GOOD_BREAK, GOOD_PICKUP).replace("        gate.reload(config);\n", "");
        assertTrue(violations(noGate).contains("reload() does not call gate.reload(config)"));
    }

    @Test
    @DisplayName("the foreign scan names every spelling of a listener construction")
    void foreignScanCatchesEverySpelling() {
        String[] samples = {
            "class G { void f() { reg(new BlockChangeListener (a)); } }",
            "class G { void f() { reg(new\nPickupProvenanceListener(a)); } }",
            "class G { void f() { reg(new dev.geldar.core.blockowner.PickupProvenanceListener(a)); } }",
            "class G { Object f = BlockChangeListener::new; }",
        };
        for (String sample : samples) {
            assertFalse(foreignConstructions("GeldarCore.java", sample).isEmpty(), sample);
        }
    }

    @Test
    @DisplayName("the foreign scan ignores a listener name in a comment, a string or a plain type reference")
    void foreignScanIgnoresMentions() {
        String mention = "// new BlockChangeListener(a)\nclass G { String s = \"new PickupProvenanceListener(\";"
                + " BlockChangeListener held; }";
        assertEquals(List.of(), foreignConstructions("GeldarCore.java", mention));
    }

    @Test
    @DisplayName("the guard reads a seam call with a space before its paren, and names its wrong gate")
    void guardCatchesSpacedSeamCall() {
        String spaced = GOOD_REGISTER + "        manager.registerEvents (pickupListener (link, () -> setup.enabled, tick,"
                + " online), plugin);\n";
        assertTrue(violations(source(spaced, GOOD_BREAK, GOOD_PICKUP)).contains(
                "register() passes pickupListener( something other than setup.gate as argument 1"));
    }

    @Test
    @DisplayName("the guard names a registerEvents (...) with a space before its paren whose argument is not a seam")
    void guardCatchesSpacedRegisterEvents() {
        String spaced = GOOD_REGISTER + "        manager.registerEvents (OtherFactory.make(), plugin);\n";
        assertTrue(violations(source(spaced, GOOD_BREAK, GOOD_PICKUP)).contains(
                "register() registers something other than a seam result: OtherFactory.make()"));
    }

    @Test
    @DisplayName("the guard names a seam call whose result is never registered (count of calls and registrations)")
    void guardCatchesUnregisteredSeamResult() {
        String bare = GOOD_REGISTER.replace("manager.registerEvents(pickupListener(link, setup.gate, tick, online), plugin);\n",
                "pickupListener(link, setup.gate, tick, online);\n");
        assertTrue(violations(source(bare, GOOD_BREAK, GOOD_PICKUP)).stream()
                .anyMatch(v -> v.startsWith("register() has 2 seam call(s) but 1 registerEvents( call(s)")));
    }

    @Test
    @DisplayName("each seam's gate argument is checked against the expression its Seam declares")
    void guardChecksGateExpressionPerSeam() {
        List<Seam> seams = List.of(new Seam("breakListener", 4, "setup.gate"), new Seam("pickupListener", 1, "setup.gate::on"));
        String onGate = GOOD_REGISTER.replace("pickupListener(link, setup.gate, tick, online)",
                "pickupListener(link, setup.gate::on, tick, online)");
        assertEquals(List.of(), violations(source(onGate, GOOD_BREAK, GOOD_PICKUP), seams));
        assertTrue(violations(source(GOOD_REGISTER, GOOD_BREAK, GOOD_PICKUP), seams).contains(
                "register() passes pickupListener( something other than setup.gate::on as argument 1"));
    }

    @Test
    @DisplayName("a seam declared public static is found, as AN-50a's seams are declared")
    void guardFindsPublicSeam() {
        String publicSeam = source(GOOD_REGISTER, GOOD_BREAK, GOOD_PICKUP).replace(
                "\n    static BlockChangeListener breakListener(", "\n    public static BlockChangeListener breakListener(");
        assertEquals(List.of(), violations(publicSeam));
    }
}
