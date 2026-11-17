import java.security.MessageDigest
import java.util.zip.ZipFile

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

    testImplementation(libs.bluemap.api) {
        isTransitive = false
    }
    testImplementation(libs.paper.api)
    testImplementation(libs.gson)
    testImplementation(libs.json.schema.validator)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The tests validate envelopes against the shared contract schemas.
    systemProperty("geldar.schemas", rootProject.layout.projectDirectory.dir("../contract/schemas").asFile.absolutePath)
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

tasks.check {
    dependsOn("verifyJarContents")
}
