import styles from './shared-ui-web.module.css';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function SharedUiWeb() {
  __useUiLocale();
  return (
    <div className={styles['container']}>
      <h1>{__uiText("Welcome to SharedUiWeb!")}</h1>
    </div>
  );
}

export default SharedUiWeb;
