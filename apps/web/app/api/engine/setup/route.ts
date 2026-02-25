import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonBody } from "../../_lib/parseBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SeedBodySchema = z.object({
  action: z.literal("seed"),
  dryRun: z.boolean().optional(),
  skipWrap: z.boolean().optional(),
  pools: z.array(z.string()).optional(),
});

const StatusBodySchema = z.object({
  action: z.literal("status"),
});

const SetupBodySchema = z.discriminatedUnion("action", [
  SeedBodySchema,
  StatusBodySchema,
]);

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, SetupBodySchema);
  if ("error" in parsed) return parsed.error;

  const body = parsed.data;

  if (body.action === "status") {
    return handleStatus();
  }

  return handleSeed(body);
}

async function handleStatus() {
  try {
    const { getNetworkConfig } = await import("@services/evm/config");
    const { env } = await import("@shared");
    const { prisma } = await import("@infra");

    const network = env.ZEPHYR_ENV as "local" | "sepolia" | "mainnet";
    const config = getNetworkConfig(network);

    const pools = (config.pools ?? []).map((p) => ({
      id: p.id,
      hasPlan: p.plan != null,
      base: p.plan?.pricing.base,
      quote: p.plan?.pricing.quote,
      price: p.plan?.pricing.price,
    }));

    // Check DB for existing active LP positions
    const positionCount = await prisma.lPPosition.count({
      where: { status: "active" },
    });

    return NextResponse.json({
      seeded: positionCount > 0,
      positionCount,
      network,
      poolCount: pools.length,
      pools,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Status check failed" },
      { status: 500 },
    );
  }
}

async function handleSeed(body: z.infer<typeof SeedBodySchema>) {
  try {
    const { getNetworkConfig } = await import("@services/evm/config");
    const { PoolSeeder } = await import("@services/evm/poolSeeder");
    const {
      createEvmExecutor,
      createZephyrWalletClient,
      createBridgeExecutor,
      createBridgeApiClient,
    } = await import("@domain/execution/factory");
    const { env } = await import("@shared");

    const network = env.ZEPHYR_ENV as "local" | "sepolia" | "mainnet";
    const config = getNetworkConfig(network);

    if (!config.pools || config.pools.length === 0) {
      return NextResponse.json(
        { error: "No pool plans found in address config" },
        { status: 400 },
      );
    }

    let poolPlans = config.pools
      .filter((p) => p.plan != null)
      .map((p) => p.plan!);

    if (body.pools && body.pools.length > 0) {
      const ids = body.pools.map((s) => s.toLowerCase());
      poolPlans = poolPlans.filter((plan) => {
        const poolId =
          `${plan.pricing.base}-${plan.pricing.quote}`.toLowerCase();
        return ids.some(
          (id) =>
            poolId.includes(id) ||
            plan.pricing.base.toLowerCase().includes(id) ||
            plan.pricing.quote.toLowerCase().includes(id),
        );
      });
    }

    if (poolPlans.length === 0) {
      return NextResponse.json(
        { error: "No pools matched the provided filter" },
        { status: 400 },
      );
    }

    const seedConfig = {
      wrapAmounts: {
        ZEPH: 80000n * 10n ** 12n,
        ZSD: 80000n * 10n ** 12n,
        ZRS: 50000n * 10n ** 12n,
        ZYS: 50000n * 10n ** 12n,
      },
      poolPlans,
    };

    const evmExecutor = createEvmExecutor();
    const zephyrWallet = createZephyrWalletClient();
    const bridgeExecutor = createBridgeExecutor(zephyrWallet, evmExecutor);
    const bridgeApiClient = createBridgeApiClient();

    const seeder = new PoolSeeder(
      evmExecutor,
      bridgeExecutor,
      bridgeApiClient,
      zephyrWallet,
      network,
    );

    if (body.dryRun) {
      const plan = seeder.dryRun(seedConfig);
      return NextResponse.json({ success: true, dryRun: true, plan });
    }

    const result = await seeder.seedAll(seedConfig, {
      skipWrap: body.skipWrap,
    });

    return NextResponse.json({
      success: result.success,
      results: result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Seed failed" },
      { status: 500 },
    );
  }
}
