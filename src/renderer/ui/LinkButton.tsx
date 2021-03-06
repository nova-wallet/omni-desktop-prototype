import React from 'react';
import { Link } from 'react-router-dom';

const SizeClass = {
  sm: 'text-sm py-1 px-4',
  md: 'text-base py-2 px-6',
  lg: 'text-lg py-4 px-8',
};

type Props = {
  to: string | object;
  className?: string;
  size?: keyof typeof SizeClass;
};

const LinkButton: React.FC<Props> = ({
  to,
  className = '',
  size = 'md',
  children,
}) => {
  return (
    <Link
      to={to}
      className={`
        bg-black hover:bg-gray-800
        rounded-lg text-white
        text-center text-base shadow-md
        flex justify-center items-center
        ${SizeClass[size]}
        ${className}
      `}
    >
      <>{children}</>
    </Link>
  );
};

export default LinkButton;
