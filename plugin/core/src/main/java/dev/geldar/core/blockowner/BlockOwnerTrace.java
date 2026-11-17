package dev.geldar.core.blockowner;

import dev.geldar.core.trace.TraceHeaders;
import io.nats.client.impl.Headers;

/** Plugs {@link TraceHeaders} into the block-owner link. With no OpenTelemetry agent every call is a no-op. */
final class BlockOwnerTrace implements NatsBlockOwnerLink.TraceSeam {
    @Override
    public NatsBlockOwnerLink.TraceSeam.Scope open(Headers incoming) {
        io.opentelemetry.context.Scope scope = TraceHeaders.extract(incoming).makeCurrent();
        return scope::close;
    }

    @Override
    public Headers inject() {
        return TraceHeaders.inject();
    }
}
