// Оплата подписки Pro в RuStore (Android). Нужен установленный RuStore и id приложения из RuStore Console.
import { Platform } from 'react-native';
import { RuStoreReactPay } from './libs/RuStoreReactPay';
import { PRO_SKUS, hasActiveRuStorePurchase } from './purchases.mjs';

export async function ruStoreAvailable() {
  if (Platform.OS !== 'android') return false;
  try {
    return await RuStoreReactPay.isRuStoreInstalled();
  } catch (e) {
    return false;
  }
}

// Тарифы из RuStore Console: цена уже в валюте магазина.
export async function ruStorePlans() {
  const products = await RuStoreReactPay.getProducts(PRO_SKUS);
  return products
    .filter((p) => p.type === 'SUBSCRIPTION')
    .map((p) => ({ id: p.productId, displayPrice: p.amountLabel, title: p.title }));
}

export async function ruStoreActive() {
  const purchases = await RuStoreReactPay.getPurchases({ productType: 'SUBSCRIPTION' });
  return hasActiveRuStorePurchase(purchases);
}

// Покупка и подтверждение выдачи доступа. Ошибку отмены пробрасываем как есть, её разбирает вызывающий код.
export async function ruStoreBuy(productId) {
  const result = await RuStoreReactPay.purchase({ productId, sdkTheme: 'LIGHT' });
  await RuStoreReactPay.updateAcknowledgementState(result.purchaseId, 'ACKNOWLEDGED').catch(() => {});
  return result;
}

export function isRuStoreCancel(error) {
  return Boolean(error) && (error.code === 'ProductPurchaseCancelled');
}
