import java.security.MessageDigest
import java.util.zip.ZipFile
import org.gradle.api.tasks.PathSensitivity

plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

dependencies {
    // The platform-neutral core (no server API). The jar below packs it, as it packs jnats.
    implementation(project(":core-common"))
    testImplementation(testFixtures(project(":core-common")))
    compileOnly(libs.paper.api)
    compileOnly(libs.gson)
    // CoreProtect's API (block owner queries). The server provides the plugin and its log4j; its jar is not in this build.
    compileOnly(libs.coreprotect) {
        isTransitive = false
    }
    // BlueMap's API for the agent skin provider (AgentSkinSetup) and the live chat feed (decision 0310). The server
    // provides BlueMap; the jar is not bundled.
    compileOnly(libs.bluemap.api) {
        isTransitive = false
    }
    // flow-math's Vector3d, which BlueMap's HtmlMarker takes. The server provides it through BlueMap; compile-only,
    // never bundled (tasks.jar packs runtimeClasspath, which does not carry compileOnly).
    compileOnly(libs.flow.math)
    implementation(libs.jnats)
    // PT-11a: the OpenTelemetry API only. With no agent it is a no-op (GlobalOpenTelemetry), and the jar bundles it.
    implementation(libs.opentelemetry.api)

    testImplementation(libs.bluemap.api) {
        isTransitive = false
    }
    testImplementation(libs.paper.api)
    testImplementation(libs.gson)
    testImplementation(libs.json.schema.validator)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

// The sources that tests read by path (relative to this project). KinoReadOnlyTest and LakituReadOnlyTest scan the kino
// and lakitu packages in both modules, and KinoReadOnlyTest also reads GeldarCore.java and config.yml. Gradle does not
// see a file that a test opens by path unless it is an input of the test task, so a comment-only edit to one of them
// left :core:test UP-TO-DATE and a banned word went unnoticed until cleanTest. Each entry is an input of :core:test
// (below). verifyTestSourceInputs (run by check) fails when a test names a src/main path that no entry covers.
val scannedSourceRoots: List<java.nio.file.Path> = listOf(
    "src/main/java/dev/geldar/core/kino",
    "src/main/java/dev/geldar/core/lakitu",
    "../core-common/src/main/java/dev/geldar/core/kino",
    "../core-common/src/main/java/dev/geldar/core/lakitu",
    "src/main/java/dev/geldar/core/GeldarCore.java",
    "src/main/resources/config.yml",
).map { projectDir.toPath().resolve(it).normalize() }

tasks.test {
    useJUnitPlatform()
    // The tests validate envelopes against the shared contract schemas.
    systemProperty("geldar.schemas", rootProject.layout.projectDirectory.dir("../contract/schemas").asFile.absolutePath)
    // Directories and files alike: a change to any of them reruns the tests.
    scannedSourceRoots.forEachIndexed { index, target ->
        if (target.toFile().isDirectory) {
            inputs.dir(target.toFile()).withPropertyName("scannedSource$index").withPathSensitivity(PathSensitivity.RELATIVE)
        } else {
            inputs.file(target.toFile()).withPropertyName("scannedSource$index").withPathSensitivity(PathSensitivity.RELATIVE)
        }
    }
}

tasks.processResources {
    filesMatching("plugin.yml") {
        expand("version" to project.version)
    }
}

// The server has no jnats, so the plugin jar carries it. Paper supplies the API and gson.
tasks.jar {
    // The packed jars are project artifacts (core-common) as well as external ones; the lambda in from() does not
    // declare its task dependencies, so depend on the runtime classpath explicitly.
    dependsOn(configurations.runtimeClasspath)
    archiveBaseName = "geldar-core"
    archiveVersion = ""
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({
        configurations.runtimeClasspath.get().filter { it.name.endsWith(".jar") }.map { zipTree(it) }
    }) {
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/MANIFEST.MF", "module-info.class")
    }
}

// Guard for the jar's contents (the platform split must not change them). The entry names, sorted, and the SHA-256 of
// the expanded plugin.yml and config.yml must match src/test/resources/jar-contents.golden. A class added to or missing
// from the jar, or a changed plugin.yml or config.yml, fails `check` with the differing lines. To accept a deliberate
// change, regenerate the golden from the new jar and review the diff.
tasks.register("verifyJarContents") {
    group = "verification"
    description = "Compares geldar-core.jar's entries and plugin.yml/config.yml hashes with jar-contents.golden."
    dependsOn(tasks.jar)
    val jarFile = tasks.jar.flatMap { it.archiveFile }
    val golden = layout.projectDirectory.file("src/test/resources/jar-contents.golden")
    inputs.file(jarFile)
    inputs.file(golden)
    doLast {
        val actual = ZipFile(jarFile.get().asFile).use { zip ->
            val names = zip.entries().asSequence()
                .filter { !it.isDirectory && it.name != "META-INF/MANIFEST.MF" }
                .map { it.name }
                .sorted()
                .toList()
            val digests = listOf("plugin.yml", "config.yml").map { name ->
                val entry = zip.getEntry(name) ?: throw GradleException("${jarFile.get().asFile.name} has no $name")
                val bytes = zip.getInputStream(entry).use { it.readBytes() }
                val hex = MessageDigest.getInstance("SHA-256").digest(bytes)
                    .joinToString("") { "%02x".format(it) }
                "$name sha256 $hex"
            }
            names + digests
        }
        val expected = golden.asFile.readLines()
        if (actual != expected) {
            val added = actual.filter { it !in expected }.map { "+ $it" }
            val missing = expected.filter { it !in actual }.map { "- $it" }
            throw GradleException(
                "geldar-core.jar differs from jar-contents.golden (${added.size} added, ${missing.size} missing):\n" +
                    (missing + added).take(200).joinToString("\n"),
            )
        }
    }
}

// Guard for the declarations above: every "src/main/..." path literal in a core test must resolve under a declared
// root, so a test that starts reading another source, or a declaration that is removed, fails `check` with the
// literal named. The test sources are declared inputs, so the task reruns when a test changes.
val verifyTestSourceInputs = tasks.register("verifyTestSourceInputs") {
    group = "verification"
    description = "Fails when a core test reads a src/main path that is not a declared input of :core:test."
    val testSources = layout.projectDirectory.dir("src/test/java")
    val basePath = projectDir.toPath()
    val declared = scannedSourceRoots
    inputs.dir(testSources)
    doLast {
        val pathLiteral = Regex("\"((?:\\.\\./)?[^\"]*src/main/[^\"]*)\"")
        val uncovered = testSources.asFile.walk()
            .filter { it.isFile && it.name.endsWith(".java") }
            .flatMap { file -> pathLiteral.findAll(file.readText()).map { it.groupValues[1] to file } }
            .filter { (path, _) ->
                val target = basePath.resolve(path).normalize()
                declared.none { target.startsWith(it) }
            }
            .map { (path, file) -> "  ${file.relativeTo(projectDir).path}: \"$path\"" }
            .toList()
        if (uncovered.isNotEmpty()) {
            throw GradleException(
                "A core test reads source paths that are not declared test inputs of :core:test. Add each missing " +
                    "root to the scannedSourceRoots list at the top of plugin/core/build.gradle.kts (a path relative " +
                    "to plugin/core, as the test reads it):\n" + uncovered.joinToString("\n"),
            )
        }
    }
}

tasks.check {
    dependsOn("verifyJarContents", verifyTestSourceInputs)
}
