/**
 * Re-exports of the shared creative schema types used by the popup editor —
 * kept colocated so editor components import from one local module instead
 * of reaching into `@josh/shared-api` individually.
 */
export type {
  CreativeElement,
  CreativeColumn,
  CreativeRow,
  ChannelDesign,
  GridItem,
  PopupChrome,
  InAppChrome,
  EmailChrome,
  PageChrome,
  PageLayoutDesign,
  Breakpoint,
  FieldDescriptor,
  InspectorFieldGroup,
  TextStyle,
  ImageStyle,
  ButtonStyle,
  CouponStyle,
  DividerStyle,
  MarketingCreativeChannels,
  MarketingTemplateButtonAction,
  CreativeI18nOverlay,
  CreativeI18nLocale,
} from '@josh/shared-api';

export { elementHasTranslatableContent } from '@josh/shared-api';

export type CouponOption = { id: string; coupon_code: string; title: string };
export type BannerOption = { id?: string; title: string; url: string };
