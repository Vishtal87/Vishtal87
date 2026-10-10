// Подписка Pro через магазины приложений (App Store, Google Play). Логика без нативных модулей, чтобы её можно было проверить тестами.
// Идентификаторы должны совпадать с продуктами в App Store Connect и Google Play Console.
export const PRO_PLANS = Object.freeze({
  monthly: 'health_diary_pro_monthly',
  yearly: 'health_diary_pro_yearly',
});

export const PRO_SKUS = Object.freeze(Object.values(PRO_PLANS));

// Порядок показа: сначала месяц, потом год.
export function sortPlans(products) {
  const order = PRO_SKUS;
  return [...products]
    .filter((p) => order.includes(p.id))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

// Запрос покупки для expo-iap. На Android подписке нужен offerToken из предложения магазина.
// Возвращает null, если предложение не найдено (товар не настроен в магазине).
export function buildSubscriptionRequest(product, platform) {
  if (!product) return null;
  if (platform === 'ios') {
    return { type: 'subs', request: { apple: { sku: product.id } } };
  }
  const offer = (product.subscriptionOffers ?? [])[0];
  if (!offer || !offer.offerToken) return null;
  return {
    type: 'subs',
    request: {
      google: {
        skus: [product.id],
        subscriptionOffers: [{ sku: product.id, offerToken: offer.offerToken }],
      },
    },
  };
}

// Есть ли среди покупок действующая подписка Pro.
export function hasProPurchase(purchases) {
  return (purchases ?? []).some((p) => PRO_SKUS.includes(p.productId ?? p.id));
}
