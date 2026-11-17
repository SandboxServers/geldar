package dev.geldar.ledger.core.disk;

/** The fixed set of values of the {@code area} attribute of {@code geldar_disk_bytes}. */
public enum DiskArea {
    WORLD("world"),
    PLUGIN_DATA("plugin_data"),
    LOGS("logs"),
    BLUEMAP("bluemap"),
    CHUNKY("chunky");

    private final String attr;

    DiskArea(String attr) {
        this.attr = attr;
    }

    public String attr() {
        return attr;
    }
}
