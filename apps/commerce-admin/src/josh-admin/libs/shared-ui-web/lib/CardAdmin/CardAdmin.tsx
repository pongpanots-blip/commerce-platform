import Text from '../text/text';
import styles from './CardAdmin.module.css';
import { uiText, useUiLocale } from '@cp/ui';

export function CardAdmin({ name = '', value = '' ,textColor=''}) {
  useUiLocale();
  return (
    <div className='w-full border border-gray-200 bg-white  rounded-md' >
      <div className='flex flex-col p-3 gap-3'>

        <Text size='base' text={uiText(name)}></Text>
        <div className={textColor ? textColor : 'text-primary'}>
          <Text bold={true} size='2xl' text={value}></Text>
        </div>


      </div>
    </div>
  );
}
export default CardAdmin;
