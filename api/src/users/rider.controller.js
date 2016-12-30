'use strict';

import uuid from 'uuid';
import { isMobilePhone, isEmail } from 'validator';
import bcrypt from 'bcrypt';
import EventEmitter from 'events';
import jwt from 'jsonwebtoken';

import Rider from './rider.model';
import { datetime, timestamp } from '../helpers/time';
import { api } from '../config/config';
import response from '../helpers/response';
import log from '../helpers/log';

const riderController = {};

riderController.add = (req, res) => {
    log.info('Hi! Adding a rider...');

    const firstname = req.body.firstname;
    const lastname = req.body.lastname;
    const email = req.body.email;
    const password = req.body.password;
    let phone = req.body.phone;

    // Split to avoid callbacks hell
    const checkEvent = new EventEmitter();

    const checking = () => {
        const errors = [];

        if (!lastname || !firstname || !phone ||
            !email || !password) {
            errors.push('missing_fields');
        } else {
            phone = `+33${req.body.phone.substr(1)}`;

            if (!isMobilePhone(phone, 'fr-FR')) {
                errors.push('incorrect_phone_number');
            } if (!isEmail(email)) {
                errors.push('incorrect_email_address');
            } if (password.length < 6) {
                errors.push('password_too_short');
            }

            if (errors.length === 0) {
                // We could use promises here, but I prefer this option

                const emailCheck = () => {
                    Rider.doesThisExist(['email', email], (result) => {
                        if (result) {
                            errors.push('email_address_already_taken');
                            checkEvent.emit('error', errors);
                        } else {
                            checkEvent.emit('success');
                        }
                    });
                };

                const phoneCheck = () => {
                    Rider.doesThisExist(['phone', phone], (result) => {
                        if (result) {
                            errors.push('phone_number_already_taken');
                            checkEvent.emit('error', errors);
                        } else {
                            emailCheck();
                        }
                    });
                };

                phoneCheck();
            }
        }

        if (errors.length > 0) {
            checkEvent.emit('error', errors);
        }
    };

    checkEvent.on('error', (err) => {
        response.error(res, 400, err);
    });

    checking();

    checkEvent.on('success', () => {
        /**
         * Generate password with 2^12 (4096) iterations for the algo.
         * Safety is priority here, performance on the side in this case
         * Become slower, but this is to "prevent" more about brute force attacks.
         * It will take more time during matching process, then more time to reverse it
         */
        bcrypt.hash(password, 12, (err, hash) => {
            const newRider = {
                lastname,
                firstname,
                phone,
                email,
                password: hash,
                uuid: uuid.v4(),
                created_at: datetime()
            };

            Rider.add(newRider, () => {
                /*
                 * Use Location header to redirect here
                 * For next 201 code, we should have the URL relatives to the new ressource
                 * Ex: /riders/:uuid
                 */
                response.successAdd(res, 'rider_added', '/signin',
                    { rider: { uuid: newRider.uuid } }
                );
            });
        });
    });
};

riderController.authenticate = (req, res) => {
    log.info('Hi! Authenticating a rider...');

    const email = req.body.email;
    const password = req.body.password;

    const checkEvent = new EventEmitter();

    const checking = () => {
        const errors = [];

        if (!email || !password) {
            errors.push('missing_fields');
        } else {
            Rider.getDataForAuth([email], (result) => {
                if (result.length !== 0) {
                    bcrypt.compare(password, result.password, (err, isMatch) => {
                        if (err) throw err;

                        if (isMatch) {
                            checkEvent.emit('success', result);
                        } else {
                            errors.push('incorrect_credentials');
                            checkEvent.emit('error', errors);
                        }
                    });
                } else {
                    errors.push('incorrect_credentials');
                    checkEvent.emit('error', errors);
                }
            });
        }

        if (errors.length > 0) {
            checkEvent.emit('error', errors);
        }
    };

    checkEvent.on('error', (err) => {
        let code = 400;

        if (err[0] === 'incorrect_credentials') {
            code = 401;
        }

        response.error(res, code, err);
    });

    checking();

    checkEvent.on('success', (data) => {
        const currentTimestamp = timestamp();
        const futureTimestamp = currentTimestamp + api().token.exp;

        const token = jwt.sign({ uuid: data.uuid, exp: futureTimestamp }, api().token.secret);

        response.success(res, 200, 'rider_authenticated',
            { token }
        );
    });
};

riderController.getAll = (req, res) => {
    console.log('Hi! Getting all of the riders...');
    Rider.getAll((rows) => {
        res.json(rows);
    });
};

export default riderController;
