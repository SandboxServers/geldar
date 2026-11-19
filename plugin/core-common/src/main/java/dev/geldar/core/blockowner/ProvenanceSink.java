package dev.geldar.core.blockowner;

/**
 * Where break provenance goes. The NATS link implements it; a tail other than the four known ones is dropped by the
 * implementation, so a caller cannot publish on an arbitrary subject.
 */
public interface ProvenanceSink {
    void send(String tail, String json);
}
