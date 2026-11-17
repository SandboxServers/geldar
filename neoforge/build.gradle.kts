// Server-side NeoForge 26.1.2 mod. Pins: neoforge.version in gradle.properties, the ModDevGradle plugin below
// (net.neoforged.moddev 2.0.148, published 2026-09-29), and JUnit in gradle/libs.versions.toml.
// The mod adds no registry entries and no network payloads, so vanilla clients are not affected.
plugins {
    java
    id("net.neoforged.moddev") version "2.0.148"
}

version = "0.1.0"
group = "dev.geldar"

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

repositories {
    // The test libraries come from Maven Central only. exclusiveContent keeps these groups off the other project
    // repositories, which ModDevGradle adds (the NeoForged maven among them), so the mirror never serves them.
    exclusiveContent {
        forRepository {
            mavenCentral()
        }
        filter {
            includeGroupAndSubgroups("org.junit")
            includeGroup("org.opentest4j")
            includeGroup("org.apiguardian")
        }
    }
}

dependencyLocking {
    lockAllConfigurations()
    // Lenient: locked versions stay pinned, but a dependency missing from the lock no longer fails; strict cannot work because Linux resolves netty epoll natives a Windows lockfile lacks (verification-metadata.xml sha256 is the integrity guard).
    lockMode = LockMode.LENIENT
}

neoForge {
    version = providers.gradleProperty("neoforge.version").get()

    runs {
        create("server") {
            server()
        }
    }

    mods {
        create("geldar_neoforge") {
            sourceSet(sourceSets.main.get())
        }
    }
}

dependencies {
    // Composite build (settings.gradle.kts): core-common is packed into this jar, because the server has neither
    // core-common nor its libraries. The range is the jar-in-jar metadata; the exact version is the plugin build version.
    implementation("dev.geldar:core-common")
    jarJar("dev.geldar:core-common") {
        version { strictly("[0.1.0]"); prefer("0.1.0") }
    }
    // jnats is nested in this jar and in no other module's jar (the single owner, see README.md; repo-checks
    // neoforge-jarjar-owner fails on a second owner). core-common declares it as an implementation dependency.
    jarJar("io.nats:jnats") {
        version { strictly("[${libs.versions.jnats.get()}]"); prefer(libs.versions.jnats.get()) }
    }

    testImplementation(libs.junit.jupiter)
    // Test-only: EventEnvelope's signature names gson's JsonObject (core-common keeps gson compileOnly).
    testImplementation(libs.gson)
    testRuntimeOnly(libs.junit.platform.launcher)
}

// The listener-registration test names the NeoForge event classes. ModDevGradle puts NeoForge on main's compile
// classpath only (not on any configuration the test set extends), so the test source set takes main's compile
// classpath. The same artifacts already resolve for main, so no new artifact is downloaded.
sourceSets {
    test {
        compileClasspath += main.get().compileClasspath
        runtimeClasspath += main.get().compileClasspath
    }
}

tasks.test {
    useJUnitPlatform()
}
