import styles from './navbar-shop.module.css';

// ui-copy-migration: only literal UI copy and notification templates
import { uiText as __uiText, formatUiMessage as __uiMessage, useUiLocale as __useUiLocale } from "@cp/ui";
export function NavbarShop() {
  __useUiLocale();
  return (
    <div className='h-14 p-4  mx-auto grid grid-cols-3 justify-evenly items-center w-full'>
      <div className='w-full  flex items-center justify-center'>   <h1>{__uiText("Welcome to NavbarShop!")}</h1></div>
      <div className='w-full  flex items-center justify-center'>

        <div className='grid grid-cols-3'>
          <span>
            1
          </span>
          <span>
            2
          </span>
          <span>
            3
          </span>


        </div>
      </div>
      <div className='w-full  flex items-center justify-center'>   <h1>{__uiText("Welcome to NavbarShop!")}</h1></div>
    </div>
  );
}

export default NavbarShop;
