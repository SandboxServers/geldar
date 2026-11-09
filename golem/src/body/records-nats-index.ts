// Export line for the NATS record sink; kept apart from index.ts so parallel packets do not collide.
export {
  type EventPublisher,
  eventIdFor,
  jetStreamPublisher,
  NatsRecordSink,
  type NatsSinkOptions,
} from './records-nats.ts';
