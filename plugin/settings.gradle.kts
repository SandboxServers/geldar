rootProject.name = "geldar-plugin"

pluginManagement {
    repositories {
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        // Only the Paper groups are looked up on the Paper repository; everything else comes from Central.
        maven("https://repo.papermc.io/repository/maven-public/") {
            content {
                includeGroupAndSubgroups("io.papermc")
                includeGroup("com.mojang")
                includeGroup("net.md-5")
            }
        }
        mavenCentral()
    }
}

include("core")