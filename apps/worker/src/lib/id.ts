import { ulid } from 'ulid';

export function newId(): string {
  return ulid();
}

export function now(): number {
  return Date.now();
}
