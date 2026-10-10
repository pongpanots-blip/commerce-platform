import { useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api";
import { commerceText as text } from "../../commerce-copy";
import {
  COMPARISON_API as endpoint,
  verifyComparisonReceipt,
  type ComparisonReceipt,
} from "../../../../../commerce-platform/src/modules/integration/competitor-prices/comparison-contracts";
import {
  clearComparisonJob,
  readComparisonJobs,
  storeComparisonJob,
  type ComparisonJob,
} from "./comparison-journal";
const message = (e: unknown) =>
  e instanceof Error
    ? e.message
    : text("อ่านข้อมูลไม่สำเร็จ ลองอีกครั้ง", "Read failed. Retry.");
export function useJobs(owner: string) {
  const [jobs, set] = useState(() => readComparisonJobs(owner));
  useEffect(() => {
    const refresh = () => set(readComparisonJobs(owner));
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("cp-comparison-journal", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("cp-comparison-journal", refresh);
    };
  }, [owner]);
  return jobs;
}
export function useComparisonWriter(owner: string) {
  const lock = useRef(false),
    mounted = useRef(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function write(job: ComparisonJob) {
    if (lock.current || !mounted.current) return null;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      try {
        storeComparisonJob(job);
      } catch {
        throw Error(
          text(
            "ยังเก็บคำขอกู้คืนไม่ได้ จึงยังไม่ส่งบันทึก",
            "Recovery storage is unavailable. No save was sent.",
          ),
        );
      }
      let receipt: ComparisonReceipt;
      try {
        receipt = verifyComparisonReceipt(
          await api.post(`${endpoint}/actions`, job.packet),
          job.packet,
        );
      } catch (e) {
        if ((e as { status?: number }).status === 409) {
          try {
            storeComparisonJob({ ...job, conflict: true });
          } catch {
            /* Original packet remains retained. */
          }
        }
        throw Error(
          text(
            "ยังยืนยันผลบันทึกไม่ได้ ตรวจคำขอเดิมก่อนส่งซ้ำ",
            "Save outcome is unverified. Check the original request before submitting again.",
          ),
        );
      }
      try {
        clearComparisonJob(owner, job.packet.requestId);
      } catch {
        /* A retained committed request can be reconciled safely. */
      }
      return mounted.current ? receipt : null;
    } catch (e) {
      if (mounted.current) setError(message(e));
      return null;
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { write, busy, error };
}
