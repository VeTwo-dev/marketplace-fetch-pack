import { Box, Text } from "ink";
import { useState, useEffect } from "react";
import { COLORS } from "../../theme.js";
import type { ReactNode } from "react";

type ToastType = "success" | "warning" | "error" | "info";

interface ToastMessage {
  readonly id: string;
  readonly type: ToastType;
  readonly message: string;
  readonly duration: number;
}

const TOAST_COLORS: Record<ToastType, string> = {
  success: COLORS.success,
  warning: COLORS.warning,
  error: COLORS.error,
  info: COLORS.info,
};

const TOAST_ICONS: Record<ToastType, string> = {
  success: "✔",
  warning: "⚠",
  error: "✖",
  info: "ℹ",
};

let toastListeners: Array<(toast: ToastMessage) => void> = [];
let toastId = 0;

function showToast(
  type: ToastType,
  message: string,
  duration: number = 3000,
): void {
  const toast: ToastMessage = {
    id: `toast-${++toastId}`,
    type,
    message,
    duration,
  };
  toastListeners.forEach((listener) => listener(toast));
}

function notifySuccess(message: string, duration?: number): void {
  showToast("success", message, duration);
}

function notifyWarning(message: string, duration?: number): void {
  showToast("warning", message, duration);
}

function notifyError(message: string, duration?: number): void {
  showToast("error", message, duration);
}

function notifyInfo(message: string, duration?: number): void {
  showToast("info", message, duration);
}

interface ToastInstance {
  readonly id: string;
  readonly type: ToastType;
  readonly message: string;
  readonly createdAt: number;
  readonly duration: number;
}

export function ToastContainer(): ReactNode {
  const [toasts, setToasts] = useState<ReadonlyArray<ToastInstance>>([]);

  useEffect(() => {
    const listener = (toast: ToastMessage) => {
      const instance: ToastInstance = {
        id: toast.id,
        type: toast.type,
        message: toast.message,
        createdAt: Date.now(),
        duration: toast.duration,
      };
      setToasts((prev) => [...prev, instance]);
    };

    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;

    const timer = setInterval(() => {
      const now = Date.now();
      setToasts((prev) =>
        prev.filter((t) => now - t.createdAt < t.duration),
      );
    }, 200);

    return () => clearInterval(timer);
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <Box position="absolute" bottom={2} right={0} flexDirection="column" gap={1}>
      {toasts.map((toast) => (
        <Box
          key={toast.id}
          paddingX={1}
          paddingY={0}
        >
          <Text color={TOAST_COLORS[toast.type]}>
            {TOAST_ICONS[toast.type]} {toast.message}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
