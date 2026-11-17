package dev.geldar.core.blockowner;

import java.util.Optional;
import java.util.function.BooleanSupplier;

/**
 * Answers blockowner.query. {@link #receive} runs on the NATS thread: it parses the request and hands the chunk to the
 * query service, which answers off the server thread. A request with no reply inbox, a malformed body, or a feed that
 * is switched off gets no reply, so the Body reads it as unknown.
 */
final class BlockOwnerResponder {
    /** Publishes a reply to the inbox the request came from. */
    interface Reply {
        void reply(String replyTo, String json);
    }

    private final OwnerQueryService service;
    private final Reply reply;
    private final BooleanSupplier enabled;

    BlockOwnerResponder(OwnerQueryService service, Reply reply, BooleanSupplier enabled) {
        this.service = service;
        this.reply = reply;
        this.enabled = enabled;
    }

    void receive(String replyTo, String body) {
        if (replyTo == null || replyTo.isEmpty() || !enabled.getAsBoolean()) {
            return;
        }
        Optional<BlockOwnerQueries.Query> query = BlockOwnerQueries.parse(body);
        if (query.isEmpty()) {
            return;
        }
        BlockOwnerQueries.Query q = query.get();
        service.answer(q.world(), q.chunkX(), q.chunkZ())
                .thenAccept(answer -> reply.reply(replyTo, BlockOwnerQueries.replyJson(answer)));
    }
}
