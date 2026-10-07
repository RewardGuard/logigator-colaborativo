#!/usr/bin/env node
/**
 * Alta de las personas autorizadas del equipo.
 *
 * Esta instalacion es privada: no hay registro publico, las cuentas las crea
 * quien administra el servidor con este script. Lee la lista de la variable de
 * entorno LOGIGATOR_TEAM, con el formato
 *
 *     usuario:correo:contrasena,usuario2:correo2:contrasena2
 *
 * Escribe directamente en la tabla `user` en vez de llamar a
 * `UserService.createLocalUser` por dos razones: ese metodo manda un correo de
 * verificacion (aqui no hay servidor de correo, y la cuenta quedaria sin poder
 * entrar) y deja `localEmailVerified` en false. Las cuentas que crea este
 * script nacen verificadas, porque quien las crea es quien administra la
 * maquina.
 *
 * La contrasena se guarda con bcrypt y el mismo numero de rondas que usa el
 * backend (`UserService.PASSWORD_SALT_ROUNDS`), asi que el inicio de sesion
 * normal las acepta sin cambios.
 *
 * Volver a ejecutarlo es seguro: una cuenta que ya existe se deja intacta,
 * salvo que se pase --update-password, que le pone la contrasena indicada.
 *
 * Uso:
 *   docker compose exec backend node tools/seed-team.js
 *   docker compose exec backend node tools/seed-team.js --update-password
 */

const mysql = require('mysql2/promise');
const { hash } = require('bcrypt');
const { randomUUID } = require('crypto');
const { readFileSync } = require('fs');
const { join } = require('path');

// Mismo coste que usa el backend al registrar por el formulario.
const PASSWORD_SALT_ROUNDS = 10;

function parseTeam(raw) {
	if (!raw || !raw.trim()) return [];
	return raw
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const parts = entry.split(':');
			if (parts.length !== 3) {
				throw new Error(
					`entrada mal formada: "${entry}" (se espera usuario:correo:contrasena)`
				);
			}
			const [username, email, password] = parts.map((p) => p.trim());
			if (!username || !email || !password) {
				throw new Error(`entrada incompleta: "${entry}"`);
			}
			if (password.length < 8) {
				throw new Error(
					`la contrasena de ${username} es demasiado corta (minimo 8)`
				);
			}
			return { username, email, password };
		});
}

function dbConfig() {
	const file = join(__dirname, '..', 'config', 'ormconfig.json');
	const cfg = JSON.parse(readFileSync(file, 'utf8'));
	return {
		host: process.env.MYSQL_HOST || cfg.host,
		port: cfg.port,
		user: cfg.username,
		password: cfg.password,
		database: cfg.database
	};
}

async function main() {
	const updatePassword = process.argv.includes('--update-password');
	const team = parseTeam(process.env.LOGIGATOR_TEAM);

	if (team.length === 0) {
		console.error(
			'LOGIGATOR_TEAM esta vacia. Formato: usuario:correo:contrasena,usuario2:correo2:contrasena2'
		);
		process.exit(1);
	}

	const connection = await mysql.createConnection(dbConfig());
	try {
		for (const member of team) {
			const [rows] = await connection.execute(
				'SELECT id FROM user WHERE email = ?',
				[member.email]
			);

			if (rows.length > 0) {
				if (updatePassword) {
					const hashed = await hash(member.password, PASSWORD_SALT_ROUNDS);
					await connection.execute(
						'UPDATE user SET password = ?, username = ?, localEmailVerified = 1 WHERE email = ?',
						[hashed, member.username, member.email]
					);
					console.log(`actualizada: ${member.username} <${member.email}>`);
				} else {
					console.log(`ya existia:  ${member.username} <${member.email}>`);
				}
				continue;
			}

			const hashed = await hash(member.password, PASSWORD_SALT_ROUNDS);
			await connection.execute(
				'INSERT INTO user (id, username, email, password, localEmailVerified) VALUES (?, ?, ?, ?, 1)',
				[randomUUID(), member.username, member.email, hashed]
			);
			console.log(`creada:      ${member.username} <${member.email}>`);
		}

		const [[{ total }]] = await connection.query(
			'SELECT COUNT(*) AS total FROM user'
		);
		console.log(`\ncuentas en la base: ${total}`);
	} finally {
		await connection.end();
	}
}

main().catch((err) => {
	console.error('fallo al dar de alta al equipo:', err.message);
	process.exit(1);
});
