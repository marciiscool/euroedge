import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  relay,
  type RateLimiter,
  type RelayChain,
  type RelayKind,
  type RelayLimits,
} from './relay.ts';

const body = z.object({
  user: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  amount: z.string().regex(/^[1-9]\d{0,30}$/),
  deadline: z.string().regex(/^\d{1,12}$/),
  signature: z.string().regex(/^0x([0-9a-fA-F]{2}){65,1024}$/),
  nonce: z
    .string()
    .regex(/^\d{1,78}$/)
    .optional(),
});

/** POST /relay/claim and /relay/deposit: same-origin JSON only, like the API (ADR-0012). */
export function registerRelay(
  app: FastifyInstance,
  deps: { chain: RelayChain; limiter: RateLimiter; limits: RelayLimits; origin: string },
): void {
  for (const kind of ['claim', 'deposit', 'withdraw'] as const satisfies readonly RelayKind[]) {
    app.post(`/relay/${kind}`, async (req, reply) => {
      if (req.headers.origin !== deps.origin)
        return reply
          .code(403)
          .send({ error: { code: 'forbidden', message: 'cross-origin request' } });
      const parsed = body.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({
          error: {
            code: 'bad-request',
            message: 'expected { user, amount, deadline, signature }',
          },
        });
      const p = parsed.data;
      if (kind === 'withdraw' && p.nonce === undefined)
        return reply
          .code(400)
          .send({ error: { code: 'bad-request', message: 'withdraw needs nonce' } });
      const result = await relay(
        deps.chain,
        deps.limiter,
        deps.limits,
        kind,
        {
          user: p.user as `0x${string}`,
          amount: BigInt(p.amount),
          deadline: BigInt(p.deadline),
          signature: p.signature as `0x${string}`,
          ...(p.nonce === undefined ? {} : { nonce: BigInt(p.nonce) }),
        },
        req.ip,
      );
      if (result.status === 'sent') return { txHash: result.txHash };
      if (result.status === 'rate-limited')
        return reply.code(429).send({
          error: { code: 'rate-limited', message: `too many requests for this ${result.scope}` },
        });
      return reply.code(400).send({ error: { code: 'rejected', message: result.reason } });
    });
  }
}
