// Server-side NeoForge adapter for the loader-neutral ledger-core. Registers no payloads and no registry entries.
// NeoForge 26.1.2 (build 126) comes from ../neoforge/gradle.properties; there is no second copy.
import java.util.Properties

plugins {
    java
    id("net.neoforged.moddev")
}

version = "0.1.0"
group = "dev.geldar"

val neoforgeProps = Properties().apply {
    file("../neoforge/gradle.properties").inputStream().use { load(it) }
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    exclusiveContent {
        forRepository {
            mavenCentral()
        }
        filter {
            includeGroupAndSubgroups("org.junit")
            includeGroup("org.opentest4j")
            includeGroup("org.apiguardian")
            includeGroup("io.opentelemetry")
        }
    }
}

dependencyLocking {
    lockAllConfigurations()
}

neoForge {
    version = neoforgeProps.getProperty("neoforge.version") ?: error("neoforge.version missing")

    runs {
        create("server") {
            server()
        }
    }

    mods {
        create("ledger") {
            sourceSet(sourceSets.main.get())
        }
    }
}

dependencies {
    implementation("dev.geldar:ledger-core")
    implementation(libs.opentelemetry.api)

    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The scan tests read these trees directly; declare them so an edit reruns the tests instead of being up to date.
    inputs.dir(layout.projectDirectory.dir("src/main"))
    inputs.dir(layout.projectDirectory.dir("../plugin/ledger-core/src/main"))
    inputs.files("gradle.properties", "../neoforge/gradle.properties", "gradle/wrapper/gradle-wrapper.properties", "../neoforge/gradle/wrapper/gradle-wrapper.properties")
    // NoLoaderImportsTest (mirror of the ledger-core test) walks the ledger-core tree for its own loader scan.
    systemProperty("ledger.core.src", file("../plugin/ledger-core/src").absolutePath)
}