import axios from "axios";
import { env } from "../config/env";

/**
 * Verificacion del gasto contra las APIs de los proveedores.
 *
 * La contabilidad local (aiusages) sigue siendo la fuente principal: es la
 * unica con detalle por usuario. Esto existe para CONTRASTAR con datos del
 * propio proveedor donde sea posible:
 *   - OpenAI: costos reales de la organizacion (requiere Admin key aparte).
 *   - DeepSeek: saldo de la cuenta (contrato verificado en su doc oficial).
 *   - Gemini: Google NO expone facturacion por API; se dice tal cual.
 *
 * Cada proveedor responde { ok, data?, note } y JAMAS lanza: un proveedor
 * caido no puede tumbar el panel.
 */

const TIMEOUT_MS = 8000;

export interface ProviderBilling {
  ok: boolean;
  data?: unknown;
  note: string;
}

async function openaiCosts(days: number): Promise<ProviderBilling> {
  if (!env.OPENAI_ADMIN_KEY) {
    return {
      ok: false,
      note:
        "Configura OPENAI_ADMIN_KEY (una Admin key sk-admin-) para consultar los " +
        "costos reales de la organizacion. Las project keys no pueden leer facturacion.",
    };
  }

  try {
    const startTime = Math.floor((Date.now() - days * 86_400_000) / 1000);
    const res = await axios.get("https://api.openai.com/v1/organization/costs", {
      headers: { Authorization: `Bearer ${env.OPENAI_ADMIN_KEY}` },
      params: { start_time: startTime, limit: 180 },
      timeout: TIMEOUT_MS,
    });

    // Cada bucket trae results[].amount.value en USD; se suma el periodo.
    const buckets: any[] = res.data?.data ?? [];
    let totalUsd = 0;
    for (const bucket of buckets) {
      for (const result of bucket?.results ?? []) {
        totalUsd += Number(result?.amount?.value ?? 0);
      }
    }

    return {
      ok: true,
      data: { totalUsd: Math.round(totalUsd * 10000) / 10000, buckets: buckets.length },
      note: `Costo real reportado por OpenAI para los ultimos ${days} dias.`,
    };
  } catch (error: any) {
    return {
      ok: false,
      note: `OpenAI no respondio la consulta de costos: ${error?.response?.status ?? ""} ${error?.message ?? ""}`.trim(),
    };
  }
}

async function deepseekBalance(): Promise<ProviderBilling> {
  if (!env.DEEPSEEK_API_KEY) {
    return { ok: false, note: "DEEPSEEK_API_KEY no configurada." };
  }

  try {
    const res = await axios.get(`${env.DEEPSEEK_BASE_URL}/user/balance`, {
      headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      timeout: TIMEOUT_MS,
    });

    // Contrato oficial: { is_available, balance_infos: [{ currency,
    // total_balance, granted_balance, topped_up_balance }] } (montos string).
    const isAvailable = !!res.data?.is_available;
    const balances = (res.data?.balance_infos ?? []).map((b: any) => ({
      currency: String(b?.currency ?? "?"),
      totalBalance: String(b?.total_balance ?? "0"),
      grantedBalance: String(b?.granted_balance ?? "0"),
      toppedUpBalance: String(b?.topped_up_balance ?? "0"),
    }));

    return {
      ok: true,
      data: { isAvailable, balances },
      note: isAvailable
        ? "Saldo real reportado por DeepSeek."
        : "ATENCION: DeepSeek reporta saldo INSUFICIENTE — las llamadas van a empezar a fallar.",
    };
  } catch (error: any) {
    return {
      ok: false,
      note: `DeepSeek no respondio la consulta de saldo: ${error?.response?.status ?? ""} ${error?.message ?? ""}`.trim(),
    };
  }
}

function geminiBilling(): ProviderBilling {
  return {
    ok: false,
    note:
      "Google no expone la facturacion de Gemini por API (vive en Google Cloud " +
      "Billing). El gasto mostrado para Gemini es el calculo local por tokens con " +
      "la tabla de precios del catalogo.",
  };
}

export async function providerBillingSnapshot(days: number): Promise<{
  openai: ProviderBilling;
  deepseek: ProviderBilling;
  gemini: ProviderBilling;
}> {
  const [openai, deepseek] = await Promise.all([openaiCosts(days), deepseekBalance()]);
  return { openai, deepseek, gemini: geminiBilling() };
}
