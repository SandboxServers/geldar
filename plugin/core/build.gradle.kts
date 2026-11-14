plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

dependencies {
    compileOnly(libs.paper.api)
    compileOnly(libs.gson)
    // CoreProtect's API (block owner queries). The server provides the plugin and its log4j; its jar is not in this build.
    compileOnly(libs.coreprotect) {
        isTransitive = false
    }
    // BlueMap's API for the agent skin provider (AgentSkinSetup) and the speech bubbles (SpeechMarkers). The server
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
    archiveBaseName = "geldar-core"
    archiveVersion = ""
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({
        configurations.runtimeClasspath.get().filter { it.name.endsWith(".jar") }.map { zipTree(it) }
    }) {
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/MANIFEST.MF", "module-info.class")
    }
}