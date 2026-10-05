import styles from './Loading-skelton.module.css';

export function LoadingSkelton() {
  return (
    <div className="container mx-auto p-6">
      <div className="h-10 w-48 bg-gray-200 animate-pulse mb-8 rounded"></div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div key={i} className="h-64 bg-gray-100 animate-pulse rounded-xl"></div>
        ))}
      </div>
    </div>
  );
}

export default LoadingSkelton;
