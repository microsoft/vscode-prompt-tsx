/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation and GitHub. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'preact/hooks';

export function useDebouncedCallback<T extends (...args: any[]) => any>(
	callback: T,
	delay: number
) {
	const timeoutIdRef = useRef<number | undefined>(undefined);

	const debouncedCallback = (...args: Parameters<T>) => {
		if (timeoutIdRef.current) {
			clearTimeout(timeoutIdRef.current);
		}
		timeoutIdRef.current = window.setTimeout(() => {
			callback(...args);
		}, delay);
	};

	useEffect(() => {
		return () => {
			if (timeoutIdRef.current) {
				clearTimeout(timeoutIdRef.current);
			}
		};
	}, []);

	return debouncedCallback;
}
