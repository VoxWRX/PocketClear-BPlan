'use client';

/**
 * @file BucketIcon.tsx
 * @description Maps semantic category icon identifiers to Lucide React vector icons.
 */

import React from 'react';
import {
  Briefcase,
  Car,
  Circle,
  Coffee,
  Gift,
  Heart,
  Home,
  Laptop,
  MoreHorizontal,
  PiggyBank,
  Plane,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Utensils,
  Wallet,
  Zap,
} from 'lucide-react';

export const AVAILABLE_BUCKET_ICONS = [
  'home',
  'shopping-cart',
  'sparkles',
  'zap',
  'car',
  'piggy-bank',
  'wallet',
  'briefcase',
  'utensils',
  'coffee',
  'heart',
  'plane',
  'laptop',
  'gift',
  'shopping-bag',
  'circle',
] as const;

export function BucketIcon({
  name,
  className = 'w-4 h-4',
}: {
  name?: string;
  className?: string;
}) {
  switch (name) {
    case 'home':
      return <Home className={className} />;
    case 'shopping-cart':
      return <ShoppingCart className={className} />;
    case 'sparkles':
      return <Sparkles className={className} />;
    case 'zap':
      return <Zap className={className} />;
    case 'car':
      return <Car className={className} />;
    case 'piggy-bank':
      return <PiggyBank className={className} />;
    case 'wallet':
      return <Wallet className={className} />;
    case 'briefcase':
      return <Briefcase className={className} />;
    case 'utensils':
      return <Utensils className={className} />;
    case 'coffee':
      return <Coffee className={className} />;
    case 'heart':
      return <Heart className={className} />;
    case 'plane':
      return <Plane className={className} />;
    case 'laptop':
      return <Laptop className={className} />;
    case 'gift':
      return <Gift className={className} />;
    case 'shopping-bag':
      return <ShoppingBag className={className} />;
    case 'more-horizontal':
      return <MoreHorizontal className={className} />;
    default:
      return <Circle className={className} />;
  }
}
