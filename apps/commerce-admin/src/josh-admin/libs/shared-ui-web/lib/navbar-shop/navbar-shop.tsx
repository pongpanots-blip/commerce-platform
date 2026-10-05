import styles from './navbar-shop.module.css';

export function NavbarShop() {
  return (
    <div className='h-14 p-4  mx-auto grid grid-cols-3 justify-evenly items-center w-full'>
      <div className='w-full  flex items-center justify-center'>   <h1>Welcome to NavbarShop!</h1></div>
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
      <div className='w-full  flex items-center justify-center'>   <h1>Welcome to NavbarShop!</h1></div>
    </div>
  );
}

export default NavbarShop;
