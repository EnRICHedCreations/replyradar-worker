import { createDecipheriv } from "node:crypto";

function key() {
  const value = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("Integration encryption is not configured.");
  return Buffer.from(value, "hex");
}

export function decrypt(value: string) {
  const b = Buffer.from(value, "base64");
  const dec = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  dec.setAuthTag(b.subarray(-16));
  return Buffer.concat([dec.update(b.subarray(12, -16)), dec.final()]).toString();
}

export function discordURL(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.hostname !== "discord.com" || u.port || u.username || u.password ||
      !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname) || u.search || u.hash) {
    throw new Error("Use a Discord webhook URL from discord.com.");
  }
  return u.toString();
}
