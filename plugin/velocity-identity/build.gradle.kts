plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

// velocity-api 3.5.1 depends on velocity-brigadier 1.0.0-SNAPSHOT, which has no release and would make the
// locks float. This plugin registers no commands, so it is left out of every classpath.
configurations.all {
    exclude(group = "com.velocitypowered", module = "velocity-brigadier")
}

dependencies {
    compileOnly(libs.velocity.api)
    compileOnly(libs.gson)
    // Velocity's annotation processor writes velocity-plugin.json from @Plugin.
    annotationProcessor(libs.velocity.api)
    implementation(libs.jnats)

    testImplementation(libs.velocity.api)
    testImplementation(libs.gson)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
}

// The proxy has no jnats, so the plugin jar carries it. Velocity supplies its own API and gson.
tasks.jar {
    archiveBaseName = "geldar-velocity-identity"
    archiveVersion = ""
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from({
        configurations.runtimeClasspath.get().filter { it.name.endsWith(".jar") }.map { zipTree(it) }
    }) {
        exclude("META-INF/*.SF", "META-INF/*.DSA", "META-INF/*.RSA", "META-INF/MANIFEST.MF", "module-info.class")
    }
}
